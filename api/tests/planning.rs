//! Integration tests for `PlanningService`, in the style of
//! `tests/master_data.rs`: each test gets its own temp SQLite file (migrated
//! fresh by `qfc_api::db::connect`) and cleans it up (including WAL sidecar
//! files) on the way out.
//!
//! Unlike the plain blob-backed master-data services, `PlanningService`
//! writes typed columns (`plan_version`, `assignment`, `absence`,
//! `quarter_data`), so several tests assert directly against those columns
//! (row counts, ids, `change_log` kind/op) rather than only round-tripping
//! through the service API.

mod common;

use buffa::view::HasMessageView;
use buffa::{Enumeration, Message};
use bytes::Bytes;
use connectrpc::{ConnectError, Encodable, ErrorCode, RequestContext, ServiceRequest};
use futures::StreamExt;
use qfc_api::auth::CurrentUser;
use qfc_api::events;
use qfc_api::proto::events::{ChangeEvent, ChangeOp, EntityKind, EventService, WatchRequest};
use qfc_api::proto::planning::{
    Absence, AbsenceType, ApplyAbsencesRequest, ApplyAssignmentsRequest, Assignment,
    CreateVersionRequest, DeleteQuarterDataRequest, DeleteVersionRequest, GetVersionRequest,
    ListHolidaysRequest, ListVersionsRequest, PlanVersion, PlanVersionMeta, PlanningService,
    PublicHoliday, QuarterData, UpdateVersionMetaRequest, UpsertQuarterDataRequest,
};
use qfc_api::proto::session::UserRole;
use qfc_api::services::events::EventServiceImpl;
use qfc_api::services::planning::PlanningServiceImpl;
use sqlx::SqlitePool;

const ACTOR: &str = "actor@example.com";

/// The baseline plan version created by migration 0005 — present in every
/// migrated database, so service tests must not assume an empty
/// `plan_version` table.
const BASELINE_VERSION_ID: &str = "v1";

/// A `RequestContext` carrying `email` as the authenticated caller, the way
/// `auth::middleware` would have set it up upstream of the handler.
fn ctx_for(email: &str) -> RequestContext {
    ctx_for_roles(email, vec![UserRole::Pm])
}

/// A `RequestContext` for a caller holding exactly `roles`, for the
/// negative-side role-gate assertions (`ctx_for` is the pm-writer default).
fn ctx_for_roles(email: &str, roles: Vec<UserRole>) -> RequestContext {
    let mut extensions = http::Extensions::new();
    extensions.insert(CurrentUser {
        email: email.to_string(),
        name: email.to_string(),
        subject: None,
        roles,
        employee_id: None,
    });
    RequestContext::new(http::HeaderMap::new()).with_extensions(extensions)
}

async fn list_versions(svc: &PlanningServiceImpl) -> Result<Vec<PlanVersionMeta>, ConnectError> {
    let body = Bytes::from(ListVersionsRequest::default().encode_to_vec());
    let view = ListVersionsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListVersionsRequest>::from_parts(&view, &body);
    let resp = svc.list_versions(ctx_for(ACTOR), req).await?;
    Ok(resp.body.versions)
}

async fn get_version(
    svc: &PlanningServiceImpl,
    version_id: &str,
) -> Result<PlanVersion, ConnectError> {
    let body = Bytes::from(
        GetVersionRequest {
            version_id: version_id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = GetVersionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<GetVersionRequest>::from_parts(&view, &body);
    let resp = svc.get_version(ctx_for(ACTOR), req).await?;
    Ok(resp.body.version.into_option().unwrap_or_default())
}

async fn create_version(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: CreateVersionRequest,
) -> Result<PlanVersion, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = CreateVersionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<CreateVersionRequest>::from_parts(&view, &body);
    let resp = svc.create_version(ctx_for(actor), req).await?;
    Ok(resp.body.version.into_option().unwrap_or_default())
}

async fn update_version_meta(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: UpdateVersionMetaRequest,
) -> Result<PlanVersionMeta, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = UpdateVersionMetaRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpdateVersionMetaRequest>::from_parts(&view, &body);
    let resp = svc.update_version_meta(ctx_for(actor), req).await?;
    Ok(resp.body.meta.into_option().unwrap_or_default())
}

async fn delete_version(
    svc: &PlanningServiceImpl,
    actor: &str,
    version_id: &str,
) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteVersionRequest {
            version_id: version_id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteVersionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteVersionRequest>::from_parts(&view, &body);
    svc.delete_version(ctx_for(actor), req).await?;
    Ok(())
}

async fn apply_assignments(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: ApplyAssignmentsRequest,
) -> Result<i64, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = ApplyAssignmentsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ApplyAssignmentsRequest>::from_parts(&view, &body);
    let resp = svc.apply_assignments(ctx_for(actor), req).await?;
    Ok(resp.body.seq)
}

async fn apply_absences(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: ApplyAbsencesRequest,
) -> Result<i64, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = ApplyAbsencesRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ApplyAbsencesRequest>::from_parts(&view, &body);
    let resp = svc.apply_absences(ctx_for(actor), req).await?;
    Ok(resp.body.seq)
}

async fn upsert_quarter_data(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: UpsertQuarterDataRequest,
) -> Result<QuarterData, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = UpsertQuarterDataRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertQuarterDataRequest>::from_parts(&view, &body);
    let resp = svc.upsert_quarter_data(ctx_for(actor), req).await?;
    Ok(resp.body.quarter.into_option().unwrap_or_default())
}

async fn delete_quarter_data(
    svc: &PlanningServiceImpl,
    actor: &str,
    version_id: &str,
    id: &str,
) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteQuarterDataRequest {
            version_id: version_id.to_string(),
            id: id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteQuarterDataRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteQuarterDataRequest>::from_parts(&view, &body);
    svc.delete_quarter_data(ctx_for(actor), req).await?;
    Ok(())
}

async fn list_holidays(svc: &PlanningServiceImpl) -> Result<Vec<PublicHoliday>, ConnectError> {
    let body = Bytes::from(ListHolidaysRequest::default().encode_to_vec());
    let view = ListHolidaysRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListHolidaysRequest>::from_parts(&view, &body);
    let resp = svc.list_holidays(ctx_for(ACTOR), req).await?;
    Ok(resp.body.holidays)
}

async fn assignment_row_count(pool: &SqlitePool, version_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM assignment WHERE version_id = ?1")
        .bind(version_id)
        .fetch_one(pool)
        .await
        .expect("count assignment rows")
}

async fn absence_row_count(pool: &SqlitePool, version_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM absence WHERE version_id = ?1")
        .bind(version_id)
        .fetch_one(pool)
        .await
        .expect("count absence rows")
}

async fn quarter_data_row_count(pool: &SqlitePool, version_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM quarter_data WHERE version_id = ?1")
        .bind(version_id)
        .fetch_one(pool)
        .await
        .expect("count quarter_data rows")
}

async fn plan_version_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM plan_version")
        .fetch_one(pool)
        .await
        .expect("count plan_version rows")
}

async fn change_log_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(pool)
        .await
        .expect("count change_log rows")
}

async fn max_seq(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM change_log")
        .fetch_one(pool)
        .await
        .expect("max seq")
}

async fn assignment_ids_by_employee(pool: &SqlitePool, version_id: &str) -> Vec<(String, String)> {
    sqlx::query_as("SELECT id, employee_id FROM assignment WHERE version_id = ?1")
        .bind(version_id)
        .fetch_all(pool)
        .await
        .expect("fetch assignment ids")
}

#[tokio::test]
async fn employee_only_caller_is_denied_planning_mutations_but_can_read() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let employee_ctx = || ctx_for_roles("emp@example.com", vec![UserRole::Employee]);

    // Creating versions, applying assignments, deleting versions — every
    // mutating RPC is pm/bl-only; a plain employee gets permission_denied.
    for (label, roles) in [
        ("employee", vec![UserRole::Employee]),
        ("sales", vec![UserRole::Sales]),
    ] {
        let body = Bytes::from(CreateVersionRequest::default().encode_to_vec());
        let view = CreateVersionRequest::decode_view(&body).expect("decode view");
        let req = ServiceRequest::<CreateVersionRequest>::from_parts(&view, &body);
        let err = svc
            .create_version(ctx_for_roles("writer@example.com", roles.clone()), req)
            .await
            .expect_err(&format!("{label}: create_version must be denied"));
        assert_eq!(err.code, ErrorCode::PermissionDenied, "{label}: code");
    }

    let body = Bytes::from(ApplyAssignmentsRequest::default().encode_to_vec());
    let view = ApplyAssignmentsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ApplyAssignmentsRequest>::from_parts(&view, &body);
    let err = svc
        .apply_assignments(employee_ctx(), req)
        .await
        .expect_err("employee: apply_assignments must be denied");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    // Reads (the read-only planner an employee sees) stay open.
    let body = Bytes::from(ListVersionsRequest::default().encode_to_vec());
    let view = ListVersionsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListVersionsRequest>::from_parts(&view, &body);
    svc.list_versions(employee_ctx(), req)
        .await
        .expect("employee can still list versions");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn create_get_round_trip_with_assignments_absences_and_ordered_forecast_data() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let created = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "2026 Plan".to_string(),
            description: Some("initial".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create ok");
    let meta = created.meta.into_option().unwrap_or_default();
    assert_eq!(meta.name, "2026 Plan");
    assert_eq!(meta.description.as_deref(), Some("initial"));
    assert!(!meta.id.is_empty());
    uuid::Uuid::parse_str(&meta.id).expect("assigned id must be a uuid");
    assert!(meta.created_at_millis > 0);
    let version_id = meta.id.clone();

    let seq = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![
                Assignment {
                    employee_id: "emp-1".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-01-05".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
                Assignment {
                    employee_id: "emp-2".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-01-06".to_string(),
                    allocation: 1.0,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    )
    .await
    .expect("apply assignments ok");
    assert!(seq > 0);

    apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: version_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-01-07".to_string(),
                absence_type: AbsenceType::Vacation.into(),
                approved: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("apply absences ok");

    for name in ["Q1", "Q2", "Q3"] {
        upsert_quarter_data(
            &svc,
            ACTOR,
            UpsertQuarterDataRequest {
                version_id: version_id.clone(),
                quarter: QuarterData {
                    name: name.to_string(),
                    ..Default::default()
                }
                .into(),
                ..Default::default()
            },
        )
        .await
        .expect("upsert quarter ok");
    }

    let fetched = get_version(&svc, &version_id).await.expect("get ok");
    let fetched_meta = fetched.meta.into_option().unwrap_or_default();
    assert_eq!(fetched_meta.id, version_id);
    assert_eq!(fetched_meta.name, "2026 Plan");

    assert_eq!(fetched.assignments.len(), 2);
    for assignment in &fetched.assignments {
        assert!(!assignment.id.is_empty());
        assert_eq!(assignment.version_id, version_id);
    }
    let employee_ids: Vec<&str> = fetched
        .assignments
        .iter()
        .map(|a| a.employee_id.as_str())
        .collect();
    assert!(employee_ids.contains(&"emp-1"));
    assert!(employee_ids.contains(&"emp-2"));

    assert_eq!(fetched.absences.len(), 1);
    assert_eq!(fetched.absences[0].employee_id, "emp-1");
    assert_eq!(
        fetched.absences[0].absence_type.as_known(),
        Some(AbsenceType::Vacation)
    );
    assert!(fetched.absences[0].approved);

    assert_eq!(fetched.forecast_data.len(), 3);
    let names: Vec<&str> = fetched
        .forecast_data
        .iter()
        .map(|q| q.name.as_str())
        .collect();
    assert_eq!(
        names,
        vec!["Q1", "Q2", "Q3"],
        "forecast_data must be ordered by insertion position"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn copy_from_version_id_deep_copies_with_fresh_ids_and_leaves_source_untouched() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let source = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Source".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create source");
    let source_id = source.meta.into_option().unwrap_or_default().id;

    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: source_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-02-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("apply assignments");
    apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: source_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-02-02".to_string(),
                absence_type: AbsenceType::Sick.into(),
                approved: false,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("apply absences");
    upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: source_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("upsert quarter");

    let source_before = get_version(&svc, &source_id)
        .await
        .expect("get source before copy");

    let copy = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Copy".to_string(),
            copy_from_version_id: Some(source_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect("create copy");
    let copy_id = copy.meta.into_option().unwrap_or_default().id;
    assert_ne!(copy_id, source_id);

    assert_eq!(copy.assignments.len(), 1);
    assert_ne!(copy.assignments[0].id, source_before.assignments[0].id);
    assert_eq!(
        copy.assignments[0].employee_id,
        source_before.assignments[0].employee_id
    );
    assert_eq!(copy.assignments[0].version_id, copy_id);

    assert_eq!(copy.absences.len(), 1);
    assert_ne!(copy.absences[0].id, source_before.absences[0].id);
    assert_eq!(
        copy.absences[0].employee_id,
        source_before.absences[0].employee_id
    );
    assert_eq!(copy.absences[0].version_id, copy_id);

    assert_eq!(copy.forecast_data.len(), 1);
    assert_ne!(copy.forecast_data[0].id, source_before.forecast_data[0].id);
    assert_eq!(
        copy.forecast_data[0].name,
        source_before.forecast_data[0].name
    );

    let source_after = get_version(&svc, &source_id)
        .await
        .expect("get source after copy");
    assert_eq!(
        source_after, source_before,
        "source version must be untouched by the copy"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn migrated_database_contains_the_baseline_plan_version() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // Migration 0005 guarantees a usable start: the baseline version exists
    // in every migrated database, with no demo data — the operator builds
    // the first real plan from it (or copies it to a new version) inside
    // the app.
    //
    // Listing also runs the plan-revision housekeeping: the current quarter
    // gets an automatic snapshot revision (deep copy of the latest), so a
    // freshly seeded database shows baseline + "Q<n> <year>" rather than
    // the bare baseline. Ordering is load-bearing (created_at ascending):
    // the snapshot was created after the baseline and must sort last.
    let versions = list_versions(&svc).await.expect("list versions");
    assert_eq!(versions.len(), 2, "baseline + automatic quarterly snapshot");
    assert_eq!(versions[0].id, BASELINE_VERSION_ID);
    assert_eq!(versions[0].name, "2026");
    assert_ne!(versions[1].id, BASELINE_VERSION_ID);
    let quarter_label = &versions[1].name;
    // Shape-only assertion ("Q<1-4> <year>", the label the auto-snapshot
    // uses) — the concrete quarter depends on the wall clock the test runs
    // under, and hardcoding a year would make this test rot by date.
    let bytes = quarter_label.as_bytes();
    let digits_year = |start: usize| {
        bytes
            .get(start..start + 4)
            .is_some_and(|d| d.iter().all(u8::is_ascii_digit))
    };
    assert_eq!(
        bytes.len(),
        7,
        "expected 'Q<n> yyyy', got {quarter_label:?}"
    );
    assert!(
        bytes[0] == b'Q' && (b'1'..=b'4').contains(&bytes[1]) && bytes[2] == b' ',
        "expected 'Q<1-4> yyyy', got {quarter_label:?}"
    );
    assert!(
        digits_year(3),
        "expected 'Q<n> yyyy', got {quarter_label:?}"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn copy_from_missing_source_version_is_not_found_and_writes_nothing() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let err = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            copy_from_version_id: Some("does-not-exist".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect_err("expected NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);
    // Only the migration-0005 baseline exists — the failed copy wrote nothing.
    assert_eq!(plan_version_row_count(&pool).await, 1);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn apply_assignments_mixed_batch_writes_expected_rows_and_change_log() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let change_log_before = change_log_row_count(&pool).await;
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![
                Assignment {
                    employee_id: "emp-1".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-03-01".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
                Assignment {
                    employee_id: "emp-2".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-03-01".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    )
    .await
    .expect("initial batch ok");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);
    assert_eq!(change_log_row_count(&pool).await, change_log_before + 2);

    let rows = assignment_ids_by_employee(&pool, &version_id).await;
    let emp1_id = rows
        .iter()
        .find(|(_, emp)| emp == "emp-1")
        .expect("emp-1 row")
        .0
        .clone();
    let emp2_id = rows
        .iter()
        .find(|(_, emp)| emp == "emp-2")
        .expect("emp-2 row")
        .0
        .clone();

    let change_log_before_second = change_log_row_count(&pool).await;
    let seq = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![
                // Update emp-1's existing cell.
                Assignment {
                    id: emp1_id.clone(),
                    employee_id: "emp-1".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-03-01".to_string(),
                    allocation: 1.0,
                    ..Default::default()
                },
                // A brand-new cell.
                Assignment {
                    employee_id: "emp-3".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-03-02".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
            ],
            delete_ids: vec![emp2_id.clone()],
            ..Default::default()
        },
    )
    .await
    .expect("mixed batch ok");
    assert!(seq > 0);

    // emp-1 (updated) + emp-3 (new) remain; emp-2 was deleted.
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);
    assert_eq!(
        change_log_row_count(&pool).await,
        change_log_before_second + 3,
        "1 update + 1 create + 1 delete = 3 change_log rows"
    );

    let (kind, op): (i32, i32) = sqlx::query_as(
        "SELECT kind, op FROM change_log WHERE entity_id = ?1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(&emp1_id)
    .fetch_one(&pool)
    .await
    .expect("fetch emp1 change_log row");
    assert_eq!(kind, EntityKind::Assignment.to_i32());
    assert_eq!(op, ChangeOp::Upsert.to_i32());

    let (kind, op): (i32, i32) = sqlx::query_as(
        "SELECT kind, op FROM change_log WHERE entity_id = ?1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(&emp2_id)
    .fetch_one(&pool)
    .await
    .expect("fetch emp2 change_log row");
    assert_eq!(kind, EntityKind::Assignment.to_i32());
    assert_eq!(op, ChangeOp::Delete.to_i32());

    let allocation: f64 = sqlx::query_scalar("SELECT allocation FROM assignment WHERE id = ?1")
        .bind(&emp1_id)
        .fetch_one(&pool)
        .await
        .expect("fetch emp1 allocation");
    assert_eq!(allocation, 1.0);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn unique_collision_updates_existing_cell_instead_of_erroring() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-04-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("first upsert ok");
    let existing_id = assignment_ids_by_employee(&pool, &version_id).await[0]
        .0
        .clone();

    // Same (employee, project, date), but a different client-supplied id —
    // must be treated as an update of the existing cell, not a new row.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                id: uuid::Uuid::new_v4().to_string(),
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-04-01".to_string(),
                allocation: 0.9,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("colliding upsert ok");

    assert_eq!(
        assignment_row_count(&pool, &version_id).await,
        1,
        "colliding upsert must update, not duplicate"
    );
    let (id, allocation): (String, f64) =
        sqlx::query_as("SELECT id, allocation FROM assignment WHERE version_id = ?1")
            .bind(&version_id)
            .fetch_one(&pool)
            .await
            .expect("fetch the single row");
    assert_eq!(id, existing_id, "the existing row's id must be preserved");
    assert_eq!(allocation, 0.9);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn deleting_nonexistent_assignment_id_is_silent_noop() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let change_log_before = change_log_row_count(&pool).await;
    let seq_before = max_seq(&pool).await;

    let seq = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            delete_ids: vec!["does-not-exist".to_string()],
            ..Default::default()
        },
    )
    .await
    .expect("no-op delete must not error");

    assert_eq!(
        seq, seq_before,
        "a no-op delete must return the pre-existing max seq"
    );
    assert_eq!(change_log_row_count(&pool).await, change_log_before);
    assert_eq!(assignment_row_count(&pool, &version_id).await, 0);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn allocation_and_date_validation_rejections_write_nothing() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let rows_before = assignment_row_count(&pool, &version_id).await;
    let change_log_before = change_log_row_count(&pool).await;

    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-05-01".to_string(),
                allocation: 0.0,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("allocation 0.0 must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-05-01".to_string(),
                allocation: 1.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("allocation above 1.0 must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "05-2026-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("malformed date must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    assert_eq!(
        assignment_row_count(&pool, &version_id).await,
        rows_before,
        "rejected batch must not write a row"
    );
    assert_eq!(
        change_log_row_count(&pool).await,
        change_log_before,
        "rejected batch must not append a change_log row"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn unspecified_absence_type_is_rejected_and_writes_nothing() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let err = apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: version_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-08-01".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("unspecified absence_type must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(absence_row_count(&pool, &version_id).await, 0);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn delete_version_cascades_and_refuses_last_version() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // The only version that exists here is the migration-0005 baseline;
    // deleting the last remaining version must be refused (the app can
    // never end up with zero plan versions).
    let err = delete_version(&svc, ACTOR, BASELINE_VERSION_ID)
        .await
        .expect_err("expected FailedPrecondition");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    let a_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "A".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create A")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: a_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-06-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("assignment ok");
    apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: a_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-06-02".to_string(),
                absence_type: AbsenceType::Sick.into(),
                approved: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("absence ok");
    upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: a_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("quarter ok");

    assert_eq!(assignment_row_count(&pool, &a_id).await, 1);
    assert_eq!(absence_row_count(&pool, &a_id).await, 1);
    assert_eq!(quarter_data_row_count(&pool, &a_id).await, 1);

    let b_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "B".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create B")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    delete_version(&svc, ACTOR, &a_id)
        .await
        .expect("delete A ok");

    // Baseline (v1) + B remain; A's assignments/absences/quarter_data are gone.
    assert_eq!(plan_version_row_count(&pool).await, 2);
    assert_eq!(
        assignment_row_count(&pool, &a_id).await,
        0,
        "cascade must remove assignments"
    );
    assert_eq!(
        absence_row_count(&pool, &a_id).await,
        0,
        "cascade must remove absences"
    );
    assert_eq!(
        quarter_data_row_count(&pool, &a_id).await,
        0,
        "cascade must remove quarter_data"
    );

    // With the baseline guaranteed to exist, B is deletable — only the
    // baseline itself is protected (see the refusal at the top of this test).
    delete_version(&svc, ACTOR, &b_id)
        .await
        .expect("delete B ok");
    assert_eq!(
        plan_version_row_count(&pool).await,
        1,
        "only the baseline version remains"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn watch_subscriber_receives_per_row_events_from_apply_assignments() {
    let (pool, db) = common::temp_pool("planning").await;
    let hub = events::Hub::new();
    let svc = PlanningServiceImpl::new(pool.clone(), hub.clone());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    // Seed a row to delete inside the watched batch.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-del".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-07-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("seed assignment ok");
    let delete_id = assignment_ids_by_employee(&pool, &version_id)
        .await
        .into_iter()
        .find(|(_, emp)| emp == "emp-del")
        .expect("seeded row")
        .0;

    let event_svc = EventServiceImpl::new(pool.clone(), hub.clone());
    let watch_body = Bytes::from(WatchRequest::default().encode_to_vec());
    let watch_view = WatchRequest::decode_view(&watch_body).expect("decode view");
    let watch_req = ServiceRequest::<WatchRequest>::from_parts(&watch_view, &watch_body);
    let resp = event_svc
        .watch(RequestContext::new(http::HeaderMap::new()), watch_req)
        .await
        .expect("watch ok");
    let mut stream = resp.body;

    let writer_svc = PlanningServiceImpl::new(pool.clone(), hub.clone());
    let writer_version_id = version_id.clone();
    let writer_delete_id = delete_id.clone();
    tokio::spawn(async move {
        apply_assignments(
            &writer_svc,
            ACTOR,
            ApplyAssignmentsRequest {
                version_id: writer_version_id,
                upserts: vec![Assignment {
                    employee_id: "emp-new".to_string(),
                    project_id: "proj-1".to_string(),
                    date: "2026-07-02".to_string(),
                    allocation: 0.4,
                    ..Default::default()
                }],
                delete_ids: vec![writer_delete_id],
                ..Default::default()
            },
        )
        .await
        .expect("watched batch ok");
    });

    let mut seen: Vec<(Option<ChangeOp>, String)> = Vec::new();
    for _ in 0..2 {
        let item = stream
            .next()
            .await
            .expect("stream ended before both events arrived")
            .expect("event delivered without error");
        let bytes = item
            .encode(connectrpc::CodecFormat::Proto)
            .expect("encode stream item");
        let event = ChangeEvent::decode_from_slice(&bytes).expect("decode ChangeEvent");
        assert_eq!(event.kind.as_known(), Some(EntityKind::Assignment));
        assert_eq!(event.version_id.as_deref(), Some(version_id.as_str()));
        seen.push((event.op.as_known(), event.entity_id));
    }
    assert!(seen.contains(&(Some(ChangeOp::Delete), delete_id)));
    assert!(seen.iter().any(|(op, _)| *op == Some(ChangeOp::Upsert)));

    db.cleanup(pool).await;
}

#[tokio::test]
async fn list_versions_orders_by_created_at_ascending() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let mut ids = Vec::new();
    for name in ["First", "Second", "Third"] {
        let created = create_version(
            &svc,
            ACTOR,
            CreateVersionRequest {
                name: name.to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("create ok");
        ids.push(created.meta.into_option().unwrap_or_default().id);
    }

    let versions = list_versions(&svc).await.expect("list ok");
    let listed_ids: Vec<String> = versions.iter().map(|v| v.id.clone()).collect();
    // The migration-0005 baseline is the oldest version (created at
    // migration time) and must sort first; the fixture versions follow in
    // creation order; the automatic quarterly snapshots — one per owner
    // (system + the pm fixture owner), created by the list's housekeeping,
    // latest — sort last.
    assert_eq!(
        &listed_ids[..listed_ids.len() - 2],
        &[BASELINE_VERSION_ID.to_string()]
            .into_iter()
            .chain(ids.clone())
            .collect::<Vec<_>>(),
        "must be ordered by created_at ascending (creation order)"
    );
    assert_eq!(
        versions.len(),
        ids.len() + 3,
        "baseline + fixtures + one quarterly snapshot per owner (system + pm)"
    );
    assert!(
        versions[listed_ids.len() - 2..]
            .iter()
            .all(|v| v.name.starts_with('Q')),
        "the newest revisions must be the automatic quarterly snapshots, got {:?}",
        versions[listed_ids.len() - 2..]
            .iter()
            .map(|v| v.name.as_str())
            .collect::<Vec<_>>()
    );
    // The two snapshots belong to different owners: the ownerless baseline's
    // system owner and the pm fixture owner.
    let snapshot_owners: std::collections::HashSet<&str> = versions[listed_ids.len() - 2..]
        .iter()
        .map(|v| v.owner.as_str())
        .collect();
    assert_eq!(snapshot_owners.len(), 2, "one snapshot per owner");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn quarterly_snapshot_deep_copies_latest_state_and_runs_only_once() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // Build real state on a copy of the migration baseline, then let the
    // list's housekeeping freeze it.
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Working".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create working version")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-08-03".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("assign ok");

    let versions = list_versions(&svc).await.expect("list versions");
    // Snapshots are per owner: the system owner freezes a copy of the
    // baseline, the pm owner freezes a copy of their working revision —
    // baseline + working + one snapshot per owner.
    assert_eq!(
        versions.len(),
        4,
        "baseline, working copy, one quarterly snapshot per owner"
    );
    let snapshot_ids: Vec<&str> = versions
        .iter()
        .filter(|v| v.name.starts_with('Q'))
        .map(|v| v.id.as_str())
        .collect();
    assert_eq!(snapshot_ids.len(), 2, "one snapshot per owner");
    let snapshots: Vec<&PlanVersionMeta> = versions
        .iter()
        .filter(|v| v.name.starts_with('Q'))
        .collect();
    for snapshot in &snapshots {
        assert_ne!(snapshot.id, version_id);
        if snapshot.owner != "system" {
            assert_eq!(
                snapshot.owner, snapshot.owner_name,
                "no users row exists for the pm owner, so the name falls back to the email"
            );
        }
    }
    // The system snapshot carries the owner label "System".
    assert!(
        snapshots
            .iter()
            .any(|s| s.owner == "system" && s.owner_name == "System"),
        "the system-owned snapshot must be labeled 'System'"
    );

    // Each snapshot is a deep copy of its owner's latest state: the pm's
    // snapshot carries the assignment (copied from Working — the baseline
    // has none), and the sources are untouched.
    let pm_snapshot = snapshots
        .iter()
        .find(|s| s.owner == ACTOR)
        .expect("pm snapshot");
    assert_eq!(assignment_row_count(&pool, &pm_snapshot.id).await, 1);
    assert_eq!(assignment_row_count(&pool, &version_id).await, 1);
    let system_snapshot = snapshots
        .iter()
        .find(|s| s.owner == "system")
        .expect("system snapshot");
    assert_eq!(assignment_row_count(&pool, &system_snapshot.id).await, 0);

    // Name-guarded per owner: a second list must not create more snapshots.
    let again = list_versions(&svc).await.expect("list again");
    assert_eq!(again.len(), 4, "no duplicate quarterly snapshot");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn list_versions_prunes_to_configured_retention_and_keeps_the_latest() {
    let (pool, db) = common::temp_pool("planning").await;
    // Environment fallback: keep only 2 user revisions. The baseline is
    // protected and does not count toward retention.
    let svc = PlanningServiceImpl::new_with_retention(pool.clone(), events::Hub::new(), 2);

    // Seed four revisions directly (skipping the service) with staggered
    // created_at so their chronological order is unambiguous. The baseline
    // from migration 0005 counts as a fifth.
    let base = 1_700_000_000_000i64;
    let names = ["Oldest", "Older", "Older2", "Newest-Before-Snapshot"];
    for (i, name) in names.iter().enumerate() {
        sqlx::query(
            "INSERT INTO plan_version (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(format!("seed-{i}"))
        .bind(name)
        .bind(base + i as i64)
        .bind(base + i as i64)
        .execute(&pool)
        .await
        .expect("insert seeded version");
    }
    assert_eq!(plan_version_row_count(&pool).await, 5);

    let versions = list_versions(&svc).await.expect("list versions");
    // The quarterly snapshot is created (newest), then pruning cuts user
    // revisions to the two newest while keeping the baseline. The migration
    // baseline is created at migration time (= now, newer than the back-dated
    // seeds), so the survivors are the baseline + the two newest user
    // revisions (seed-3 and the snapshot); the three oldest back-dated seeds
    // are pruned.
    assert_eq!(
        versions.len(),
        3,
        "baseline + 2 newest user revisions remain"
    );
    assert_eq!(plan_version_row_count(&pool).await, 3);
    let names: std::collections::HashSet<String> =
        versions.iter().map(|v| v.name.clone()).collect();
    assert!(names.contains("2026"), "baseline must survive");
    assert!(
        names.contains("Newest-Before-Snapshot"),
        "seed-3 must survive"
    );
    assert!(
        versions.iter().any(|v| v.name.starts_with('Q')),
        "quarterly snapshot must survive"
    );

    // Pruned revisions are announced as DELETE events, so connected clients
    // drop the frozen view as it disappears.
    let delete_events =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM change_log WHERE op = ?1 AND kind = ?2")
            .bind(ChangeOp::Delete as i32)
            .bind(EntityKind::PlanVersion as i32)
            .fetch_one(&pool)
            .await
            .expect("count delete events");
    assert_eq!(delete_events, 3, "three oldest seeds pruned");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn meta_retention_override_wins_over_environment() {
    let (pool, db) = common::temp_pool("planning").await;
    // Environment says 10, but the meta override (what the admin UI
    // writes) says 2 — the override must win. The baseline is protected
    // and does not count toward the 2 user revisions.
    let svc = PlanningServiceImpl::new_with_retention(pool.clone(), events::Hub::new(), 10);
    sqlx::query("INSERT INTO meta (key, value) VALUES ('settings.plan_revision_retention', '2')")
        .execute(&pool)
        .await
        .expect("write meta override");

    let base = 1_700_000_000_000i64;
    for i in 0..4 {
        sqlx::query(
            "INSERT INTO plan_version (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(format!("m-{i}"))
        .bind(format!("V{i}"))
        .bind(base + i)
        .bind(base + i)
        .execute(&pool)
        .await
        .expect("insert version");
    }

    let versions = list_versions(&svc).await.expect("list versions");
    assert_eq!(
        versions.len(),
        3,
        "baseline + meta retention 2 user revisions"
    );
    assert_eq!(plan_version_row_count(&pool).await, 3);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn write_to_frozen_revision_fails() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // v1 is the baseline. Create v2 from it, making v2 the latest and v1 frozen.
    let v2 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v2".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create v2");
    let v2_id = v2.meta.into_option().unwrap_or_default().id;

    // Create v3 from v2, making v3 the latest and v2 frozen.
    let v3 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v3".to_string(),
            copy_from_version_id: Some(v2_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect("create v3");
    let v3_id = v3.meta.into_option().unwrap_or_default().id;

    // Mutating the frozen v2 must fail with FailedPrecondition.
    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: v2_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-01-05".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("apply assignments on frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    let err = apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: v2_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-01-05".to_string(),
                absence_type: AbsenceType::Vacation.into(),
                approved: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("apply absences on frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    // Seed a quarter_data row on v3 so delete_quarter_data has a real target
    // to attempt against the frozen v2.
    let quarter = upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: v3_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("upsert quarter on v3");

    let err = upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: v2_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect_err("upsert quarter data on frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    let err = delete_quarter_data(&svc, ACTOR, &v2_id, &quarter.id)
        .await
        .expect_err("delete quarter data on frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    let err = update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id: v2_id.clone(),
            name: "Renamed".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect_err("update version meta on frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn copy_from_frozen_or_foreign_version_is_allowed() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // v2, v3 by the same actor: v2 is frozen once v3 exists (latest of the
    // owner). Freezing affects mutation, not copying.
    let v2 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v2".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create v2");
    let v2_id = v2.meta.into_option().unwrap_or_default().id;

    let v3 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v3".to_string(),
            copy_from_version_id: Some(v2_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect("create v3");
    let v3_id = v3.meta.into_option().unwrap_or_default().id;

    // v2 is now frozen (v3 is the owner's latest) — copying from it must
    // succeed, since only version existence is required of a copy source.
    let v4 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v4".to_string(),
            copy_from_version_id: Some(v2_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect("copy from frozen revision must be allowed");
    let v4_id = v4.meta.into_option().unwrap_or_default().id;
    assert_ne!(v4_id, v2_id);
    assert_ne!(v4_id, v3_id);

    // A foreign owner's revision is also a valid copy source.
    let foreign = create_version(
        &svc,
        "other@example.com",
        CreateVersionRequest {
            name: "foreign".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create foreign version");
    let foreign_id = foreign.meta.into_option().unwrap_or_default().id;
    let copied_foreign = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "copy-of-foreign".to_string(),
            copy_from_version_id: Some(foreign_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect("copy from a foreign owner's version must be allowed");
    assert_eq!(
        copied_foreign.meta.into_option().unwrap_or_default().owner,
        ACTOR,
        "the copy belongs to the copying actor, not the source owner"
    );

    // The system-owned baseline is also copyable.
    let from_baseline = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "from-baseline".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("copy from the system baseline must be allowed");
    assert!(
        !from_baseline
            .meta
            .into_option()
            .unwrap_or_default()
            .id
            .is_empty()
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn write_to_latest_revision_still_works() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let latest = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Latest".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create latest");
    let latest_id = latest.meta.into_option().unwrap_or_default().id;

    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: latest_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-01-05".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("apply assignments on latest");

    apply_absences(
        &svc,
        ACTOR,
        ApplyAbsencesRequest {
            version_id: latest_id.clone(),
            upserts: vec![Absence {
                employee_id: "emp-1".to_string(),
                date: "2026-01-05".to_string(),
                absence_type: AbsenceType::Vacation.into(),
                approved: true,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("apply absences on latest");

    let quarter = upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: latest_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("upsert quarter data on latest");

    update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id: latest_id.clone(),
            name: "Renamed Latest".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("update version meta on latest");

    delete_quarter_data(&svc, ACTOR, &latest_id, &quarter.id)
        .await
        .expect("delete quarter data on latest");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn update_version_meta_renames_and_returns_not_found_for_missing_version() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let meta = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Old Name".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default();

    let updated = update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id: meta.id.clone(),
            name: "New Name".to_string(),
            description: Some("updated desc".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("update ok");
    assert_eq!(updated.id, meta.id);
    assert_eq!(updated.name, "New Name");
    assert_eq!(updated.description.as_deref(), Some("updated desc"));
    assert_eq!(
        updated.created_at_millis, meta.created_at_millis,
        "created_at must survive a rename"
    );

    let err = update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id: "does-not-exist".to_string(),
            name: "Whatever".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect_err("expected NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn empty_name_is_rejected_on_create_and_update() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let err = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: String::new(),
            ..Default::default()
        },
    )
    .await
    .expect_err("expected InvalidArgument");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    // Only the migration-0005 baseline exists — the rejected create wrote nothing.
    assert_eq!(plan_version_row_count(&pool).await, 1);

    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Valid".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let err = update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id,
            name: String::new(),
            ..Default::default()
        },
    )
    .await
    .expect_err("expected InvalidArgument");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_quarter_data_keeps_position_on_update_and_delete_is_idempotent_not_found() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    let q1 = upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: version_id.clone(),
            quarter: QuarterData {
                name: "Q1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("create Q1");
    upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: version_id.clone(),
            quarter: QuarterData {
                name: "Q2".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("create Q2");

    // Update Q1 (existing id): must keep its position (before Q2), not move
    // to the end.
    upsert_quarter_data(
        &svc,
        ACTOR,
        UpsertQuarterDataRequest {
            version_id: version_id.clone(),
            quarter: QuarterData {
                id: q1.id.clone(),
                name: "Q1".to_string(),
                notes: "revised".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
    )
    .await
    .expect("update Q1");

    let fetched = get_version(&svc, &version_id).await.expect("get ok");
    let names: Vec<&str> = fetched
        .forecast_data
        .iter()
        .map(|q| q.name.as_str())
        .collect();
    assert_eq!(
        names,
        vec!["Q1", "Q2"],
        "Q1 must keep its original position after an update"
    );
    assert_eq!(fetched.forecast_data[0].notes, "revised");

    delete_quarter_data(&svc, ACTOR, &version_id, &q1.id)
        .await
        .expect("delete Q1 ok");
    let err = delete_quarter_data(&svc, ACTOR, &version_id, &q1.id)
        .await
        .expect_err("expected NotFound on repeat delete");
    assert_eq!(err.code, ErrorCode::NotFound);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn get_version_of_missing_id_returns_not_found() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let err = get_version(&svc, "does-not-exist")
        .await
        .expect_err("expected NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn list_holidays_returns_rows_ordered_by_date() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    sqlx::query("INSERT INTO public_holiday (date, location, name) VALUES (?1, ?2, ?3)")
        .bind("2026-12-25")
        .bind("ALL")
        .bind("Christmas")
        .execute(&pool)
        .await
        .expect("seed holiday");
    sqlx::query("INSERT INTO public_holiday (date, location, name) VALUES (?1, ?2, ?3)")
        .bind("2026-01-01")
        .bind("ALL")
        .bind("New Year")
        .execute(&pool)
        .await
        .expect("seed holiday");

    let holidays = list_holidays(&svc).await.expect("list ok");
    assert_eq!(holidays.len(), 2);
    assert_eq!(holidays[0].date, "2026-01-01");
    assert_eq!(holidays[1].date, "2026-12-25");

    db.cleanup(pool).await;
}

async fn update_version_meta_with_roles(
    svc: &PlanningServiceImpl,
    roles: Vec<UserRole>,
    request: UpdateVersionMetaRequest,
) -> Result<PlanVersionMeta, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = UpdateVersionMetaRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpdateVersionMetaRequest>::from_parts(&view, &body);
    let resp = svc
        .update_version_meta(ctx_for_roles("bl@example.com", roles), req)
        .await?;
    Ok(resp.body.meta.into_option().unwrap_or_default())
}

/// Test-only seed of an `account` row (status stored as its proto variant
/// name, the way `ProjectService::upsert_account` writes it) with a
/// server-style fresh id when `id` is empty.
async fn insert_account(pool: &SqlitePool, id: &str, project_id: &str, name: &str) -> String {
    let id = if id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        id.to_string()
    };
    sqlx::query(
        "INSERT INTO account (id, project_id, name, status, created_at) VALUES (?1, ?2, ?3, 'ACCOUNT_STATUS_CONFIRMED', ?4)",
    )
    .bind(&id)
    .bind(project_id)
    .bind(name)
    .bind(qfc_api::time::now_millis())
    .execute(pool)
    .await
    .expect("insert account row");
    id
}

async fn assignment_account_ids(pool: &SqlitePool, version_id: &str) -> Vec<Option<String>> {
    sqlx::query_as::<_, (Option<String>,)>(
        "SELECT account_id FROM assignment WHERE version_id = ?1 ORDER BY id",
    )
    .bind(version_id)
    .fetch_all(pool)
    .await
    .expect("fetch assignment account ids")
    .into_iter()
    .map(|(account_id,)| account_id)
    .collect()
}

/// Test-only seed of a `project` blob row (the shape
/// `ProjectService::upsert_project`/`crud` writes), so `account` inserts —
/// which require a real project — work without standing up the whole
/// `ProjectService`.
async fn insert_project(pool: &SqlitePool, id: &str, name: &str) {
    #[allow(unused_imports)]
    use buffa::Message as _;
    let project = qfc_api::proto::portfolio::Project {
        id: id.to_string(),
        name: name.to_string(),
        ..Default::default()
    };
    sqlx::query("INSERT INTO project (id, updated_at, data) VALUES (?1, ?2, ?3)")
        .bind(id)
        .bind(qfc_api::time::now_millis())
        .bind(project.encode_to_vec())
        .execute(pool)
        .await
        .expect("insert project row");
}

#[tokio::test]
async fn create_version_sets_owner_and_meta_exposes_it() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let created = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Owned Plan".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok");
    let meta = created.meta.into_option().unwrap_or_default();
    assert_eq!(meta.owner, ACTOR, "the creating pm owns the version");
    assert_eq!(
        meta.owner_name, ACTOR,
        "without a users row the display name falls back to the email"
    );

    // The owner column is persisted, and both list + fetch expose it.
    let stored_owner: String = sqlx::query_scalar("SELECT owner FROM plan_version WHERE id = ?1")
        .bind(&meta.id)
        .fetch_one(&pool)
        .await
        .expect("fetch stored owner");
    assert_eq!(stored_owner, ACTOR);

    let versions = list_versions(&svc).await.expect("list versions");
    let listed = versions
        .iter()
        .find(|v| v.id == meta.id)
        .expect("created version listed");
    assert_eq!(listed.owner, ACTOR);
    assert_eq!(listed.owner_name, ACTOR);

    let fetched = get_version(&svc, &meta.id).await.expect("get ok");
    let fetched_meta = fetched.meta.into_option().unwrap_or_default();
    assert_eq!(fetched_meta.owner, ACTOR);
    assert_eq!(fetched_meta.owner_name, ACTOR);

    // The deployment baseline is owned by "system" and labeled "System".
    let baseline = versions
        .iter()
        .find(|v| v.id == BASELINE_VERSION_ID)
        .expect("baseline listed");
    assert_eq!(baseline.owner, "system");
    assert_eq!(baseline.owner_name, "System");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn pm_edits_own_plan_despite_newer_foreign_version() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // actorA owns v2; actorB then creates their own v3. Under the old
    // global-latest rule actorA's v2 would be frozen by v3; per owner it
    // stays the latest of actorA and remains editable by actorA.
    let v2 = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "A-v2".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("A creates v2");
    let v2_id = v2.meta.into_option().unwrap_or_default().id;

    create_version(
        &svc,
        "other@example.com",
        CreateVersionRequest {
            name: "B-v3".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("B creates v3");

    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: v2_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-09-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("A can still apply assignments to own v2");

    update_version_meta(
        &svc,
        ACTOR,
        UpdateVersionMetaRequest {
            version_id: v2_id.clone(),
            name: "A-v2 renamed".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("A can still rename own v2");

    assert_eq!(assignment_row_count(&pool, &v2_id).await, 1);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn pm_cannot_mutate_foreign_version() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let a = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "A's plan".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("A creates version");
    let a_id = a.meta.into_option().unwrap_or_default().id;
    let other = "other@example.com";

    // A foreign pm cannot rename, delete, or plan into A's version.
    let err = update_version_meta(
        &svc,
        other,
        UpdateVersionMetaRequest {
            version_id: a_id.clone(),
            name: "hijacked".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect_err("foreign pm rename must fail");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = apply_assignments(
        &svc,
        other,
        ApplyAssignmentsRequest {
            version_id: a_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-09-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("foreign pm apply assignments must fail");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = delete_version(&svc, other, &a_id)
        .await
        .expect_err("foreign pm delete must fail");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    // Nothing was written.
    assert_eq!(assignment_row_count(&pool, &a_id).await, 0);
    assert!(
        plan_version_row_count(&pool).await >= 2,
        "baseline + A's version remain"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn bl_can_mutate_foreign_versions_but_not_system() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let a = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "A's plan".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("A creates version");
    let a_id = a.meta.into_option().unwrap_or_default().id;

    // A bl manages every non-system plan: renaming A's latest version is
    // allowed even though the bl is not its owner.
    update_version_meta_with_roles(
        &svc,
        vec![UserRole::Bl],
        UpdateVersionMetaRequest {
            version_id: a_id.clone(),
            name: "managed by bl".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("bl can rename a foreign pm's version");
    let listed = list_versions(&svc).await.expect("list versions");
    assert!(
        listed
            .iter()
            .any(|v| v.id == a_id && v.name == "managed by bl")
    );

    // The system-owned baseline stays read-only even for a bl.
    let err = update_version_meta_with_roles(
        &svc,
        vec![UserRole::Bl],
        UpdateVersionMetaRequest {
            version_id: BASELINE_VERSION_ID.to_string(),
            name: "tampered baseline".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect_err("bl cannot mutate the system baseline");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn quarterly_snapshot_is_created_per_owner() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    // Two pms plan in parallel: each owner's history must freeze its own
    // quarterly snapshot, copying that owner's (distinct) latest state.
    let a_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "Plan A".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("A creates version")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: a_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-a".to_string(),
                project_id: "proj-a".to_string(),
                date: "2026-08-03".to_string(),
                allocation: 1.0,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("A assigns");

    let b_id = create_version(
        &svc,
        "other@example.com",
        CreateVersionRequest {
            name: "Plan B".to_string(),
            copy_from_version_id: Some(BASELINE_VERSION_ID.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("B creates version")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;
    apply_assignments(
        &svc,
        "other@example.com",
        ApplyAssignmentsRequest {
            version_id: b_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-b".to_string(),
                project_id: "proj-b".to_string(),
                date: "2026-08-04".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("B assigns");

    let versions = list_versions(&svc).await.expect("list versions");
    let snapshots: Vec<&PlanVersionMeta> = versions
        .iter()
        .filter(|v| v.name.starts_with('Q'))
        .collect();
    // system + two pm owners = three snapshots.
    assert_eq!(snapshots.len(), 3, "one quarterly snapshot per owner");
    let by_owner: std::collections::HashMap<&str, &PlanVersionMeta> =
        snapshots.iter().map(|s| (s.owner.as_str(), *s)).collect();
    assert!(by_owner.contains_key("system"));
    assert!(by_owner.contains_key(ACTOR));
    assert!(by_owner.contains_key("other@example.com"));

    // Each pm snapshot deep-copies exactly its own owner's latest state.
    assert_eq!(
        assignment_row_count(&pool, &by_owner[ACTOR].id).await,
        1,
        "A's snapshot carries A's assignment only"
    );
    let a_snapshot_emps: Vec<String> =
        sqlx::query_scalar("SELECT employee_id FROM assignment WHERE version_id = ?1")
            .bind(&by_owner[ACTOR].id)
            .fetch_all(&pool)
            .await
            .expect("fetch A snapshot employees");
    assert_eq!(a_snapshot_emps, vec!["emp-a".to_string()]);
    assert_eq!(
        assignment_row_count(&pool, &by_owner["other@example.com"].id).await,
        1
    );
    let b_snapshot_emps: Vec<String> =
        sqlx::query_scalar("SELECT employee_id FROM assignment WHERE version_id = ?1")
            .bind(&by_owner["other@example.com"].id)
            .fetch_all(&pool)
            .await
            .expect("fetch B snapshot employees");
    assert_eq!(b_snapshot_emps, vec!["emp-b".to_string()]);

    // Per-owner name guard: a second list creates nothing new.
    let again = list_versions(&svc).await.expect("list again");
    assert_eq!(
        again.len(),
        versions.len(),
        "no duplicate quarterly snapshot"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn pruning_is_per_owner() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new_with_retention(pool.clone(), events::Hub::new(), 5);

    // Owner A exceeds retention (7 seeded revisions); owner B stays within
    // it (3 seeded). Seeded back-dated so the quarterly snapshots (created
    // by the list call) sort newest. The migration baseline (system) is
    // protected and does not count toward anyone's retention.
    let base = 1_700_000_000_000i64;
    for i in 0..7 {
        sqlx::query(
            "INSERT INTO plan_version (id, name, created_at, updated_at, owner) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(format!("a-{i}"))
        .bind(format!("A{i}"))
        .bind(base + i)
        .bind(base + i)
        .bind(ACTOR)
        .execute(&pool)
        .await
        .expect("insert A version");
    }
    for i in 0..3 {
        sqlx::query(
            "INSERT INTO plan_version (id, name, created_at, updated_at, owner) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(format!("b-{i}"))
        .bind(format!("B{i}"))
        .bind(base + 100 + i)
        .bind(base + 100 + i)
        .bind("other@example.com")
        .execute(&pool)
        .await
        .expect("insert B version");
    }

    // The list call's housekeeping freezes one quarterly snapshot per owner
    // (which counts toward each owner's retention) and then prunes.
    list_versions(&svc).await.expect("list versions");
    // A: 7 seeds + 1 snapshot = 8, retention 5 -> 3 oldest pruned (a-0..a-2).
    // B: 3 seeds + 1 snapshot = 4 <= 5 -> untouched. system: baseline +
    // snapshot = 2 -> untouched. The quarterly snapshot of each owner is
    // kept, so the newest revision of EACH owner survives.
    assert_eq!(
        plan_version_row_count(&pool).await,
        1 + 4 + 5 + 1,
        "baseline + B kept 4 + A kept 5 + system's quarterly snapshot"
    );
    let survivors: Vec<String> = sqlx::query_scalar("SELECT name FROM plan_version")
        .fetch_all(&pool)
        .await
        .expect("fetch surviving names");
    for pruned in ["A0", "A1", "A2"] {
        assert!(
            !survivors.iter().any(|n| n == pruned),
            "{pruned} must be pruned"
        );
    }
    assert!(
        survivors.iter().any(|n| n == "A6"),
        "the newest A revision survives"
    );
    assert!(
        survivors.iter().any(|n| n == "B2"),
        "the newest B revision survives"
    );
    assert!(
        survivors.iter().any(|n| n == "B0"),
        "B's oldest revision survives (B never exceeds retention)"
    );
    // B's count is unaffected by A's pruning: B kept all 3 + its snapshot.
    let b_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plan_version WHERE owner = ?1")
        .bind("other@example.com")
        .fetch_one(&pool)
        .await
        .expect("count B rows");
    assert_eq!(b_count, 4, "pruning is per owner");

    let delete_events: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM change_log WHERE op = ?1 AND kind = ?2")
            .bind(ChangeOp::Delete as i32)
            .bind(EntityKind::PlanVersion as i32)
            .fetch_one(&pool)
            .await
            .expect("count delete events");
    assert_eq!(delete_events, 3, "exactly A's three oldest are pruned");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn assignment_account_must_exist_and_belong_to_project() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    insert_project(&pool, "proj-1", "Project 1").await;
    let acc_1 = insert_account(&pool, "", "proj-1", "Account 1").await;
    insert_project(&pool, "proj-2", "Project 2").await;
    let acc_2 = insert_account(&pool, "", "proj-2", "Account 2").await;

    // A valid assignment onto an account of the assignment's own project.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                account_id: Some(acc_1.clone()),
                date: "2026-09-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("assignment onto the account's own project");

    // Account does not exist -> NotFound, nothing written.
    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-2".to_string(),
                project_id: "proj-1".to_string(),
                account_id: Some("does-not-exist".to_string()),
                date: "2026-09-02".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("unknown account must be NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);

    // Account of another project -> InvalidArgument, nothing written.
    let err = apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-3".to_string(),
                project_id: "proj-1".to_string(),
                account_id: Some(acc_2.clone()),
                date: "2026-09-03".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect_err("account of another project must be InvalidArgument");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    assert_eq!(
        assignment_row_count(&pool, &version_id).await,
        1,
        "only the valid assignment was written"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn two_accounts_same_project_same_day_are_distinct_cells() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    insert_project(&pool, "proj-1", "Project 1").await;
    let acc_1 = insert_account(&pool, "", "proj-1", "Account 1").await;
    let acc_2 = insert_account(&pool, "", "proj-1", "Account 2").await;

    // Same employee, same project, same day — but different accounts: two
    // distinct cells (unique per (version, employee, account, date)).
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![
                Assignment {
                    employee_id: "emp-1".to_string(),
                    project_id: "proj-1".to_string(),
                    account_id: Some(acc_1.clone()),
                    date: "2026-09-01".to_string(),
                    allocation: 0.4,
                    ..Default::default()
                },
                Assignment {
                    employee_id: "emp-1".to_string(),
                    project_id: "proj-1".to_string(),
                    account_id: Some(acc_2.clone()),
                    date: "2026-09-01".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    )
    .await
    .expect("two account cells on the same day");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);

    // Re-upserting the same (version, employee, account, date) cell with a
    // different id/allocation updates it in place instead of duplicating.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                id: uuid::Uuid::new_v4().to_string(),
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                account_id: Some(acc_1.clone()),
                date: "2026-09-01".to_string(),
                allocation: 0.9,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("same account cell updates in place");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);
    let allocations: Vec<f64> = sqlx::query_scalar(
        "SELECT allocation FROM assignment WHERE version_id = ?1 AND account_id = ?2",
    )
    .bind(&version_id)
    .bind(&acc_1)
    .fetch_all(&pool)
    .await
    .expect("fetch allocations");
    assert_eq!(allocations, vec![0.9]);
    let accounts: std::collections::HashSet<String> = assignment_account_ids(&pool, &version_id)
        .await
        .into_iter()
        .map(|a| a.expect("account cells carry account ids"))
        .collect();
    assert_eq!(accounts.len(), 2, "both accounts keep their distinct cells");
    assert!(accounts.contains(&acc_1));
    assert!(accounts.contains(&acc_2));

    db.cleanup(pool).await;
}

#[tokio::test]
async fn legacy_null_account_planning_still_works() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());
    let version_id = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;

    insert_project(&pool, "proj-1", "Project 1").await;
    let acc_1 = insert_account(&pool, "", "proj-1", "Account 1").await;

    // Legacy planning keeps working: no account_id, unique per
    // (version, employee, project, date).
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-09-01".to_string(),
                allocation: 0.5,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("legacy null-account assignment");
    assert_eq!(assignment_account_ids(&pool, &version_id).await, vec![None]);

    // Same legacy cell re-upserted updates in place and stays NULL.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                id: uuid::Uuid::new_v4().to_string(),
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                date: "2026-09-01".to_string(),
                allocation: 0.8,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("legacy cell updates in place");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 1);
    assert_eq!(assignment_account_ids(&pool, &version_id).await, vec![None]);
    let allocation: f64 =
        sqlx::query_scalar("SELECT allocation FROM assignment WHERE version_id = ?1")
            .bind(&version_id)
            .fetch_one(&pool)
            .await
            .expect("fetch allocation");
    assert_eq!(allocation, 0.8);

    // Legacy NULL and account-planning cells coexist for the same employee
    // on the same day: the partial unique indexes make them distinct.
    apply_assignments(
        &svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![Assignment {
                employee_id: "emp-1".to_string(),
                project_id: "proj-1".to_string(),
                account_id: Some(acc_1),
                date: "2026-09-01".to_string(),
                allocation: 0.3,
                ..Default::default()
            }],
            ..Default::default()
        },
    )
    .await
    .expect("account cell alongside the legacy cell");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);

    db.cleanup(pool).await;
}
