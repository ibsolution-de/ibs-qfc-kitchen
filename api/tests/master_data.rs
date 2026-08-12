//! Integration tests for the master-data Connect services (`TeamService` and
//! `GrowthService`), in the style of `tests/events.rs`: each test gets its
//! own temp SQLite file (migrated fresh by `qfc_api::db::connect`) and
//! cleans it up (including WAL sidecar files) on the way out.
//!
//! `TeamServiceImpl` exercises the shared `services::crud` path every plain
//! blob-backed entity service (`team`, `crm`, `portfolio`, `strategy`) goes
//! through; a couple of `GrowthServiceImpl` tests additionally cover the
//! hand-written `one_on_one` path documented in `services/growth.rs`.

mod common;

use buffa::view::HasMessageView;
use buffa::{Enumeration, Message};
use bytes::Bytes;
use connectrpc::{ConnectError, Encodable, ErrorCode, RequestContext, ServiceRequest};
use futures::StreamExt;
use qfc_api::auth::CurrentUser;
use qfc_api::events;
use qfc_api::proto::events::{ChangeOp, EntityKind, EventService, WatchRequest};
use qfc_api::proto::growth::{
    DeleteSessionRequest, GrowthService, ListSessionsRequest, OneOnOneSession, UpsertSessionRequest,
};
use qfc_api::proto::session::UserRole;
use qfc_api::proto::team::{
    DeleteEmployeeRequest, Employee, EmploymentType, ListEmployeesRequest, TeamService,
    UpsertEmployeeRequest,
};
use qfc_api::services::events::EventServiceImpl;
use qfc_api::services::growth::GrowthServiceImpl;
use qfc_api::services::team::TeamServiceImpl;
use sqlx::SqlitePool;

const ACTOR: &str = "actor@example.com";

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

async fn list_employees(svc: &TeamServiceImpl) -> Result<Vec<Employee>, ConnectError> {
    let body = Bytes::from(ListEmployeesRequest::default().encode_to_vec());
    let view = ListEmployeesRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListEmployeesRequest>::from_parts(&view, &body);
    let resp = svc.list_employees(ctx_for(ACTOR), req).await?;
    Ok(resp.body.employees)
}

async fn upsert_employee(
    svc: &TeamServiceImpl,
    actor: &str,
    employee: Employee,
) -> Result<Employee, ConnectError> {
    let body = Bytes::from(
        UpsertEmployeeRequest {
            employee: employee.into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpsertEmployeeRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertEmployeeRequest>::from_parts(&view, &body);
    let resp = svc.upsert_employee(ctx_for(actor), req).await?;
    Ok(resp.body.employee.into_option().unwrap_or_default())
}

async fn delete_employee(svc: &TeamServiceImpl, actor: &str, id: &str) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteEmployeeRequest {
            id: id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteEmployeeRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteEmployeeRequest>::from_parts(&view, &body);
    svc.delete_employee(ctx_for(actor), req).await?;
    Ok(())
}

async fn upsert_session(
    svc: &GrowthServiceImpl,
    actor: &str,
    session: OneOnOneSession,
) -> Result<OneOnOneSession, ConnectError> {
    let body = Bytes::from(
        UpsertSessionRequest {
            session: session.into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpsertSessionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertSessionRequest>::from_parts(&view, &body);
    let resp = svc.upsert_session(ctx_for(actor), req).await?;
    Ok(resp.body.session.into_option().unwrap_or_default())
}

async fn delete_session(
    svc: &GrowthServiceImpl,
    actor: &str,
    id: &str,
) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteSessionRequest {
            id: id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteSessionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteSessionRequest>::from_parts(&view, &body);
    svc.delete_session(ctx_for(actor), req).await?;
    Ok(())
}

/// A fully-populated `Employee`, used by the round-trip test — every field
/// gets a distinguishable value so an accidental field swap during
/// encode/decode would be caught.
fn sample_employee(id: &str) -> Employee {
    Employee {
        id: id.to_string(),
        name: "Ada Lovelace".to_string(),
        role: "Engineer".to_string(),
        avatar: "https://example.com/avatar.png".to_string(),
        skills: vec!["rust".to_string(), "proto".to_string()],
        availability: 80,
        location: "UK".to_string(),
        employment_type: EmploymentType::Internal.into(),
        ..Default::default()
    }
    .with_email("ada@example.com")
    .with_phone("+44123456789")
    .with_notes("some notes")
    .with_team_id("team-1")
    .with_department("engineering")
}

async fn employee_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM employee")
        .fetch_one(pool)
        .await
        .expect("count employee rows")
}

async fn change_log_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(pool)
        .await
        .expect("count change_log rows")
}

#[tokio::test]
async fn upsert_with_empty_id_assigns_and_returns_id() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    let employee = Employee {
        name: "New Hire".to_string(),
        ..Default::default()
    };
    let created = upsert_employee(&svc, ACTOR, employee)
        .await
        .expect("upsert ok");

    assert!(
        !created.id.is_empty(),
        "server must assign an id when the client sends none"
    );
    uuid::Uuid::parse_str(&created.id).expect("assigned id should be a UUID");

    let rows = list_employees(&svc).await.expect("list ok");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, created.id);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_then_list_round_trips_entity_field_by_field() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    let sent = sample_employee("");
    let created = upsert_employee(&svc, ACTOR, sent.clone())
        .await
        .expect("upsert ok");

    let rows = list_employees(&svc).await.expect("list ok");
    assert_eq!(rows.len(), 1);
    let round_tripped = &rows[0];

    // Field-by-field, not just a count or a single struct-level assert.
    assert_eq!(round_tripped.id, created.id);
    assert_eq!(round_tripped.name, sent.name);
    assert_eq!(round_tripped.role, sent.role);
    assert_eq!(round_tripped.avatar, sent.avatar);
    assert_eq!(round_tripped.skills, sent.skills);
    assert_eq!(round_tripped.availability, sent.availability);
    assert_eq!(round_tripped.email, sent.email);
    assert_eq!(round_tripped.phone, sent.phone);
    assert_eq!(round_tripped.notes, sent.notes);
    assert_eq!(round_tripped.location, sent.location);
    assert_eq!(round_tripped.team_id, sent.team_id);
    assert_eq!(round_tripped.employment_type, sent.employment_type);
    assert_eq!(round_tripped.department, sent.department);

    // And the whole message, for good measure (Employee derives PartialEq).
    let mut expected = sent;
    expected.id = created.id;
    assert_eq!(round_tripped, &expected);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn update_of_existing_id_replaces_rather_than_duplicates() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    let created = upsert_employee(
        &svc,
        ACTOR,
        Employee {
            name: "Original Name".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok");

    let updated = upsert_employee(
        &svc,
        ACTOR,
        Employee {
            id: created.id.clone(),
            name: "Updated Name".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("update ok");
    assert_eq!(updated.id, created.id);

    assert_eq!(
        employee_row_count(&pool).await,
        1,
        "update must replace, not add a row"
    );

    let rows = list_employees(&svc).await.expect("list ok");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, created.id);
    assert_eq!(rows[0].name, "Updated Name");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn delete_of_missing_id_returns_not_found() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    let err = delete_employee(&svc, ACTOR, "does-not-exist")
        .await
        .expect_err("expected NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn role_gates_deny_employee_only_and_sales_only_callers_from_writing_team() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    // Neither a plain employee (read-only planner) nor a sales-only caller
    // may edit the company directory; only pm/bl can.
    for (label, roles) in [
        ("employee", vec![UserRole::Employee]),
        ("sales", vec![UserRole::Sales]),
    ] {
        let body = Bytes::from(
            UpsertEmployeeRequest {
                employee: sample_employee("").into(),
                ..Default::default()
            }
            .encode_to_vec(),
        );
        let view = UpsertEmployeeRequest::decode_view(&body).expect("decode view");
        let req = ServiceRequest::<UpsertEmployeeRequest>::from_parts(&view, &body);
        let err = svc
            .upsert_employee(ctx_for_roles("writer@example.com", roles.clone()), req)
            .await
            .expect_err(&format!("{label}: upsert must be denied"));
        assert_eq!(
            err.code,
            ErrorCode::PermissionDenied,
            "{label}: denial code"
        );
    }

    // ... and a sales-only caller also cannot delete an existing employee.
    let created = upsert_employee(&svc, ACTOR, sample_employee("")).await.expect("seed employee");
    let body = Bytes::from(
        DeleteEmployeeRequest {
            id: created.id.clone(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteEmployeeRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteEmployeeRequest>::from_parts(&view, &body);
    let err = svc
        .delete_employee(
            ctx_for_roles("sales@example.com", vec![UserRole::Sales]),
            req,
        )
        .await
        .expect_err("sales: delete must be denied");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    // Reads stay open to every authenticated user.
    let body = Bytes::from(ListEmployeesRequest::default().encode_to_vec());
    let view = ListEmployeesRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListEmployeesRequest>::from_parts(&view, &body);
    svc.list_employees(
        ctx_for_roles("reader@example.com", vec![UserRole::Employee]),
        req,
    )
    .await
    .expect("employee can still list the directory");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn employee_only_caller_is_denied_from_writing_one_on_one_sessions() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = GrowthServiceImpl::new(pool.clone(), events::Hub::new());

    let body = Bytes::from(
        UpsertSessionRequest {
            session: OneOnOneSession {
                id: "s1".to_string(),
                employee_id: "e1".to_string(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpsertSessionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertSessionRequest>::from_parts(&view, &body);
    let err = svc
        .upsert_session(ctx_for_roles("emp@example.com", vec![UserRole::Employee]), req)
        .await
        .expect_err("employee must be denied from writing 1:1 sessions");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn validation_failure_returns_invalid_argument_and_writes_nothing() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    let rows_before = employee_row_count(&pool).await;
    let change_log_before = change_log_row_count(&pool).await;

    // Empty `name` fails `validate_employee`.
    let err = upsert_employee(
        &svc,
        ACTOR,
        Employee {
            name: String::new(),
            ..Default::default()
        },
    )
    .await
    .expect_err("expected InvalidArgument");
    assert_eq!(err.code, ErrorCode::InvalidArgument);

    assert_eq!(
        employee_row_count(&pool).await,
        rows_before,
        "rejected upsert must not write a row"
    );
    assert_eq!(
        change_log_row_count(&pool).await,
        change_log_before,
        "rejected upsert must not append a change_log row"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn each_mutation_appends_exactly_one_change_log_row_with_kind_op_actor() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = TeamServiceImpl::new(pool.clone(), events::Hub::new());

    // Create.
    let before_create = change_log_row_count(&pool).await;
    let created = upsert_employee(
        &svc,
        ACTOR,
        Employee {
            name: "Grace Hopper".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create ok");
    assert_eq!(change_log_row_count(&pool).await, before_create + 1);

    let (kind, op, actor_email): (i32, i32, String) = sqlx::query_as(
        "SELECT kind, op, actor_email FROM change_log WHERE entity_id = ?1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(&created.id)
    .fetch_one(&pool)
    .await
    .expect("fetch change_log row");
    assert_eq!(kind, EntityKind::Employee.to_i32());
    assert_eq!(op, ChangeOp::Upsert.to_i32());
    assert_eq!(actor_email, ACTOR);

    // Update.
    let before_update = change_log_row_count(&pool).await;
    upsert_employee(
        &svc,
        ACTOR,
        Employee {
            id: created.id.clone(),
            name: "Grace Hopper (updated)".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("update ok");
    assert_eq!(change_log_row_count(&pool).await, before_update + 1);

    let (kind, op, _): (i32, i32, String) = sqlx::query_as(
        "SELECT kind, op, actor_email FROM change_log WHERE entity_id = ?1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(&created.id)
    .fetch_one(&pool)
    .await
    .expect("fetch change_log row");
    assert_eq!(kind, EntityKind::Employee.to_i32());
    assert_eq!(op, ChangeOp::Upsert.to_i32());

    // Delete.
    let before_delete = change_log_row_count(&pool).await;
    delete_employee(&svc, ACTOR, &created.id)
        .await
        .expect("delete ok");
    assert_eq!(change_log_row_count(&pool).await, before_delete + 1);

    let (kind, op, actor_email): (i32, i32, String) = sqlx::query_as(
        "SELECT kind, op, actor_email FROM change_log WHERE entity_id = ?1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(&created.id)
    .fetch_one(&pool)
    .await
    .expect("fetch change_log row");
    assert_eq!(kind, EntityKind::Employee.to_i32());
    assert_eq!(op, ChangeOp::Delete.to_i32());
    assert_eq!(actor_email, ACTOR);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn watch_subscriber_receives_event_for_service_upsert() {
    let (pool, db) = common::temp_pool("master-data").await;
    let hub = events::Hub::new();
    let event_svc = EventServiceImpl::new(pool.clone(), hub.clone());

    // Subscribe (via Watch, since_seq = 0: live only) before the write, the
    // same way `tests/events.rs`'s concurrent-write test does.
    let watch_body = Bytes::from(WatchRequest::default().encode_to_vec());
    let watch_view = WatchRequest::decode_view(&watch_body).expect("decode view");
    let watch_req = ServiceRequest::<WatchRequest>::from_parts(&watch_view, &watch_body);
    let resp = event_svc
        .watch(RequestContext::new(http::HeaderMap::new()), watch_req)
        .await
        .expect("watch ok");
    let mut stream = resp.body;

    let writer_pool = pool.clone();
    let writer_team_svc = TeamServiceImpl::new(writer_pool, hub.clone());
    tokio::spawn(async move {
        upsert_employee(
            &writer_team_svc,
            ACTOR,
            Employee {
                name: "Watched Employee".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("upsert via service");
    });

    let item = stream
        .next()
        .await
        .expect("stream ended before an event arrived")
        .expect("event delivered without error");
    let bytes = item
        .encode(connectrpc::CodecFormat::Proto)
        .expect("encode stream item");
    let event =
        qfc_api::proto::events::ChangeEvent::decode_from_slice(&bytes).expect("decode ChangeEvent");

    assert_eq!(event.kind.as_known(), Some(EntityKind::Employee));
    assert_eq!(event.op.as_known(), Some(ChangeOp::Upsert));
    assert_eq!(event.actor_email, ACTOR);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn growth_session_upsert_keeps_employee_id_column_in_sync() {
    let (pool, db) = common::temp_pool("master-data").await;
    let svc = GrowthServiceImpl::new(pool.clone(), events::Hub::new());

    let created = upsert_session(
        &svc,
        ACTOR,
        OneOnOneSession {
            employee_id: "emp-42".to_string(),
            // 2026-01-01T00:00:00Z in epoch millis (instants convention).
            date_millis: 1_767_225_600_000,
            ..Default::default()
        },
    )
    .await
    .expect("upsert ok");
    assert!(!created.id.is_empty());

    let stored_employee_id: String =
        sqlx::query_scalar("SELECT employee_id FROM one_on_one WHERE id = ?1")
            .bind(&created.id)
            .fetch_one(&pool)
            .await
            .expect("fetch employee_id column");
    assert_eq!(stored_employee_id, "emp-42");

    let sessions_body = Bytes::from(ListSessionsRequest::default().encode_to_vec());
    let sessions_view = ListSessionsRequest::decode_view(&sessions_body).expect("decode view");
    let sessions_req =
        ServiceRequest::<ListSessionsRequest>::from_parts(&sessions_view, &sessions_body);
    let sessions = svc
        .list_sessions(ctx_for(ACTOR), sessions_req)
        .await
        .expect("list ok")
        .body
        .sessions;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].employee_id, "emp-42");

    delete_session(&svc, ACTOR, &created.id)
        .await
        .expect("delete ok");
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM one_on_one")
        .fetch_one(&pool)
        .await
        .expect("count one_on_one rows");
    assert_eq!(remaining, 0);

    db.cleanup(pool).await;
}
