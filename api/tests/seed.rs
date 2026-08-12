//! Integration tests for the first-run seed pipeline (`seed::seed_if_empty`
//! / `seed::seed_from_json`), in the style of `tests/planning.rs`: each test
//! gets its own temp SQLite file (migrated fresh by `qfc_api::db::connect`)
//! and cleans it up (including WAL sidecar files) on the way out.
//!
//! `seed_from_json` (rather than `seed_if_empty` alone) is what makes the
//! "malformed seed file" case testable at all: `seed_if_empty` only ever
//! reads the compile-time-embedded real `seed/seed.json`, so a corrupted
//! string has to go in through the parameterized entry point instead.

mod common;

use qfc_api::seed::{seed_from_json, seed_if_empty};
use sqlx::SqlitePool;

/// `table` is always one of this file's own hand-written literals (see call
/// sites below), never caller/request input, so the dynamic SQL string this
/// builds is safe to assert past sqlx 0.9's `SqlSafeStr` audit — the same
/// reasoning `store::list_blobs` documents for its own `Table`-driven SQL.
async fn count(pool: &SqlitePool, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .fetch_one(pool)
        .await
        .expect("count rows")
}

/// The real, generated seed artifact this crate embeds — read independently
/// here (rather than trusting `seed_if_empty`'s own `include_str!`) so the
/// row-count assertions below are checked against the JSON, not against
/// whatever the seed code itself happens to compute.
fn real_seed_json() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/seed/seed.json"))
        .expect("read seed/seed.json")
}

fn array_len(value: &serde_json::Value, key: &str) -> usize {
    value
        .get(key)
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len)
}

/// The number of distinct `(employeeId, projectId, date)` cells in one
/// version's `assignments` array.
///
/// Not simply `array_len(version, "assignments")`: see `seed.rs`'s
/// module-level doc comment — the generated fixture genuinely has two
/// entries in `v3` that double-book the same cell (a manually authored row
/// on top of an auto-generated one for the same employee/project/date), and
/// `insert_plan_version` upserts those onto one row rather than failing, the
/// same way a live `ApplyAssignments` call would. Row-count assertions
/// below must match that de-duplication, not the raw array length.
fn distinct_assignment_cells(version: &serde_json::Value) -> usize {
    let mut cells = std::collections::HashSet::new();
    for assignment in version
        .get("assignments")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        cells.insert((
            assignment["employeeId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            assignment["projectId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            assignment["date"].as_str().unwrap_or_default().to_string(),
        ));
    }
    cells.len()
}

#[tokio::test]
async fn seed_if_empty_populates_row_counts_matching_the_json_and_writes_no_change_log() {
    let (pool, db) = common::temp_pool("seed").await;

    let raw = real_seed_json();
    let expected: serde_json::Value =
        serde_json::from_str(&raw).expect("seed.json must be valid JSON");
    let expected_versions = expected["versions"].as_array().cloned().unwrap_or_default();
    let expected_customers = array_len(&expected, "customers");
    let expected_assignments: usize = expected_versions
        .iter()
        .map(distinct_assignment_cells)
        .sum();
    let expected_absences: usize = expected_versions
        .iter()
        .map(|v| array_len(v, "absences"))
        .sum();
    let expected_quarter_data: usize = expected_versions
        .iter()
        .map(|v| array_len(v, "forecastData"))
        .sum();

    let seeded = seed_if_empty(&pool).await.expect("seed ok");
    assert!(
        seeded,
        "first call against an empty db must perform the seed"
    );

    assert_eq!(
        count(&pool, "employee").await as usize,
        array_len(&expected, "employees")
    );
    assert_eq!(
        count(&pool, "project").await as usize,
        array_len(&expected, "projects")
    );
    assert_eq!(
        count(&pool, "customer").await as usize,
        array_len(&expected, "customers")
    );
    assert_eq!(
        count(&pool, "strategic_goal").await as usize,
        array_len(&expected, "goals")
    );
    assert_eq!(
        count(&pool, "north_star").await as usize,
        array_len(&expected, "northStars")
    );
    assert_eq!(
        count(&pool, "one_on_one").await as usize,
        array_len(&expected, "oneOnOnes")
    );
    assert_eq!(
        count(&pool, "public_holiday").await as usize,
        array_len(&expected, "holidays")
    );
    // `+ 1`: migration 0005's baseline version exists in every migrated
    // database; the seed itself ships no demo versions (seed.json
    // `versions: []`).
    assert_eq!(
        count(&pool, "plan_version").await as usize,
        expected_versions.len() + 1
    );
    assert_eq!(
        count(&pool, "assignment").await as usize,
        expected_assignments
    );
    assert_eq!(count(&pool, "absence").await as usize, expected_absences);
    assert_eq!(
        count(&pool, "quarter_data").await as usize,
        expected_quarter_data
    );
    assert!(
        expected_customers > 0,
        "sanity check: the seed must carry at least the internal customer"
    );

    assert_eq!(
        count(&pool, "change_log").await,
        0,
        "seeding must never write change_log rows"
    );

    let seeded_marker: Option<String> =
        sqlx::query_scalar("SELECT value FROM meta WHERE key = 'seeded'")
            .fetch_optional(&pool)
            .await
            .expect("query meta");
    assert!(seeded_marker.is_some(), "meta.seeded must be set");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn second_call_is_a_no_op_and_does_not_duplicate_rows() {
    let (pool, db) = common::temp_pool("seed").await;

    assert!(seed_if_empty(&pool).await.expect("first seed ok"));
    let employees_after_first = count(&pool, "employee").await;
    let assignments_after_first = count(&pool, "assignment").await;

    let seeded_again = seed_if_empty(&pool)
        .await
        .expect("second call must not error");
    assert!(
        !seeded_again,
        "a database already marked seeded must not be re-seeded"
    );
    assert_eq!(
        count(&pool, "employee").await,
        employees_after_first,
        "second call must not duplicate employee rows"
    );
    assert_eq!(
        count(&pool, "assignment").await,
        assignments_after_first,
        "second call must not duplicate assignment rows"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn corrupted_seed_json_fails_and_writes_nothing() {
    let (pool, db) = common::temp_pool("seed").await;

    let err = seed_from_json(&pool, "{ this is not valid json")
        .await
        .expect_err("malformed JSON must error");
    assert!(matches!(err, qfc_api::error::AppError::Internal(_)));

    // A failed parse must happen before the transaction opens any writes —
    // and even if it happened after, the transaction must never have
    // committed: every seed table, and the `seeded` marker itself, must be
    // untouched.
    assert_eq!(count(&pool, "employee").await, 0);
    // The migration-0005 baseline exists; nothing from the failed seed did.
    assert_eq!(count(&pool, "plan_version").await, 1);
    assert_eq!(count(&pool, "assignment").await, 0);
    assert_eq!(
        count(&pool, "meta").await,
        0,
        "a rolled-back attempt must not leave a `seeded` marker behind"
    );

    // Since the failed attempt never committed a `seeded` marker, a
    // subsequent good call must still be able to seed normally.
    let seeded = seed_from_json(&pool, &real_seed_json())
        .await
        .expect("seed ok after a prior failed attempt");
    assert!(seeded);
    assert!(
        count(&pool, "customer").await > 0,
        "the production baseline must re-seed the internal customer"
    );

    db.cleanup(pool).await;
}
