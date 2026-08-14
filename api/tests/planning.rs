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
        bytes.get(start..start + 4).is_some_and(|d| d.iter().all(u8::is_ascii_digit))
    };
    assert_eq!(bytes.len(), 7, "expected 'Q<n> yyyy', got {quarter_label:?}");
    assert!(
        bytes[0] == b'Q' && (b'1'..=b'4').contains(&bytes[1]) && bytes[2] == b' ',
        "expected 'Q<1-4> yyyy', got {quarter_label:?}"
    );
    assert!(digits_year(3), "expected 'Q<n> yyyy', got {quarter_label:?}");

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
    // creation order; the automatic quarterly snapshot (created by the
    // list's housekeeping, latest) sorts last.
    assert_eq!(
        &listed_ids[..listed_ids.len() - 1],
        &[BASELINE_VERSION_ID.to_string()].into_iter().chain(ids.clone()).collect::<Vec<_>>(),
        "must be ordered by created_at ascending (creation order)"
    );
    assert_eq!(versions.len(), ids.len() + 2, "baseline + fixtures + quarterly snapshot");
    assert!(
        versions.last().map(|v| v.name.starts_with("Q")).unwrap_or(false),
        "the newest revision must be the automatic quarterly snapshot, got {:?}",
        versions.last().map(|v| v.name.as_str())
    );

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
    // Baseline + working + the automatic quarterly snapshot.
    assert_eq!(versions.len(), 3, "baseline, working copy, quarterly snapshot");
    let snapshot = versions.last().unwrap().clone();
    assert_ne!(snapshot.id, version_id);
    assert!(
        snapshot.name.starts_with('Q'),
        "snapshot must carry the quarter label, got {:?}",
        snapshot.name
    );

    // The snapshot is a deep copy: it carries the assignment, the source is
    // untouched.
    assert_eq!(assignment_row_count(&pool, &snapshot.id).await, 1);
    assert_eq!(assignment_row_count(&pool, &version_id).await, 1);

    // Name-guarded: a second list must not create another snapshot.
    let again = list_versions(&svc).await.expect("list again");
    assert_eq!(again.len(), 3, "no duplicate quarterly snapshot");

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
    assert_eq!(versions.len(), 3, "baseline + 2 newest user revisions remain");
    assert_eq!(plan_version_row_count(&pool).await, 3);
    let names: std::collections::HashSet<String> =
        versions.iter().map(|v| v.name.clone()).collect();
    assert!(names.contains("2026"), "baseline must survive");
    assert!(names.contains("Newest-Before-Snapshot"), "seed-3 must survive");
    assert!(
        versions.iter().any(|v| v.name.starts_with('Q')),
        "quarterly snapshot must survive"
    );

    // Pruned revisions are announced as DELETE events, so connected clients
    // drop the frozen view as it disappears.
    let delete_events = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM change_log WHERE op = ?1 AND kind = ?2",
    )
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
    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ('settings.plan_revision_retention', '2')",
    )
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
    assert_eq!(versions.len(), 3, "baseline + meta retention 2 user revisions");
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
async fn create_version_copy_from_frozen_fails() {
    let (pool, db) = common::temp_pool("planning").await;
    let svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

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

    let _v3 = create_version(
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

    // v3 is now latest; copying from v2 (frozen) must fail.
    let err = create_version(
        &svc,
        ACTOR,
        CreateVersionRequest {
            name: "v4".to_string(),
            copy_from_version_id: Some(v2_id.clone()),
            ..Default::default()
        },
    )
    .await
    .expect_err("copy from frozen revision should fail");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

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
