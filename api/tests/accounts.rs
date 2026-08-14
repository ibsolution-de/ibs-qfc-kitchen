//! Integration tests for `ProjectService`'s account (Beauftragung) surface,
//! in the style of `tests/master_data.rs`: each test gets its own temp
//! SQLite file (migrated fresh by `qfc_api::db::connect`) and cleans it up
//! (including WAL sidecar files) on the way out.
//!
//! Accounts are a typed table (`account`) hanging off exactly one project;
//! `Project.accounts` is a read projection only (never stored in the project
//! blob). `PlanningService` assigns resources onto accounts, and deleting an
//! account cascades those assignment rows away via the FK.

mod common;

use buffa::view::HasMessageView;
use buffa::{Enumeration, Message};
use bytes::Bytes;
use connectrpc::{ConnectError, ErrorCode, RequestContext, ServiceRequest};
use qfc_api::auth::CurrentUser;
use qfc_api::events;
use qfc_api::proto::events::{ChangeOp, EntityKind};
use qfc_api::proto::planning::{
    ApplyAssignmentsRequest, Assignment, CreateVersionRequest, PlanningService,
};
use qfc_api::proto::portfolio::{
    Account, AccountStatus, DeleteAccountRequest, ListProjectsRequest, Project, ProjectService,
    UpsertAccountRequest, UpsertProjectRequest,
};
use qfc_api::proto::session::UserRole;
use qfc_api::services::planning::PlanningServiceImpl;
use qfc_api::services::portfolio::ProjectServiceImpl;
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

async fn list_projects(svc: &ProjectServiceImpl) -> Result<Vec<Project>, ConnectError> {
    let body = Bytes::from(ListProjectsRequest::default().encode_to_vec());
    let view = ListProjectsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListProjectsRequest>::from_parts(&view, &body);
    let resp = svc.list_projects(ctx_for(ACTOR), req).await?;
    Ok(resp.body.projects)
}

async fn upsert_project(
    svc: &ProjectServiceImpl,
    actor: &str,
    project: Project,
) -> Result<Project, ConnectError> {
    let body = Bytes::from(
        UpsertProjectRequest {
            project: project.into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpsertProjectRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertProjectRequest>::from_parts(&view, &body);
    let resp = svc
        .upsert_project(
            ctx_for_roles(actor, vec![UserRole::Pm, UserRole::Sales]),
            req,
        )
        .await?;
    Ok(resp.body.project.into_option().unwrap_or_default())
}

async fn upsert_account(
    svc: &ProjectServiceImpl,
    actor: &str,
    account: Account,
) -> Result<Account, ConnectError> {
    let body = Bytes::from(
        UpsertAccountRequest {
            account: account.into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpsertAccountRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertAccountRequest>::from_parts(&view, &body);
    let resp = svc
        .upsert_account(
            ctx_for_roles(actor, vec![UserRole::Pm, UserRole::Sales]),
            req,
        )
        .await?;
    Ok(resp.body.account.into_option().unwrap_or_default())
}

async fn delete_account(
    svc: &ProjectServiceImpl,
    actor: &str,
    id: &str,
) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteAccountRequest {
            id: id.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteAccountRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteAccountRequest>::from_parts(&view, &body);
    svc.delete_account(
        ctx_for_roles(actor, vec![UserRole::Pm, UserRole::Sales]),
        req,
    )
    .await?;
    Ok(())
}

async fn create_version(
    svc: &PlanningServiceImpl,
    actor: &str,
    request: CreateVersionRequest,
) -> Result<qfc_api::proto::planning::PlanVersion, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = CreateVersionRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<CreateVersionRequest>::from_parts(&view, &body);
    let resp = svc.create_version(ctx_for(actor), req).await?;
    Ok(resp.body.version.into_option().unwrap_or_default())
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

async fn account_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM account")
        .fetch_one(pool)
        .await
        .expect("count account rows")
}

async fn assignment_row_count(pool: &SqlitePool, version_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM assignment WHERE version_id = ?1")
        .bind(version_id)
        .fetch_one(pool)
        .await
        .expect("count assignment rows")
}

async fn assignment_count_by_account(pool: &SqlitePool, account_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM assignment WHERE account_id = ?1")
        .bind(account_id)
        .fetch_one(pool)
        .await
        .expect("count assignments on account")
}

async fn change_log_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(pool)
        .await
        .expect("count change_log rows")
}

async fn assignment_event_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM change_log WHERE kind = ?1")
        .bind(EntityKind::Assignment.to_i32())
        .fetch_one(pool)
        .await
        .expect("count assignment events")
}

#[tokio::test]
async fn list_projects_embeds_accounts() {
    let (pool, db) = common::temp_pool("accounts").await;
    let svc = ProjectServiceImpl::new(pool.clone(), events::Hub::new());

    let project_id = upsert_project(
        &svc,
        ACTOR,
        Project {
            name: "Project A".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create project")
    .id;

    let acc_1 = upsert_account(
        &svc,
        ACTOR,
        Account {
            project_id: project_id.clone(),
            name: "Confirmed Order".to_string(),
            status: AccountStatus::Confirmed.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create confirmed account");
    let acc_2 = upsert_account(
        &svc,
        ACTOR,
        Account {
            project_id: project_id.clone(),
            name: "Requested Lead".to_string(),
            status: AccountStatus::Requested.into(),
            start_date: Some("2026-09-01".to_string()),
            end_date: Some("2026-12-31".to_string()),
            budget: Some("80k".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("create requested account");

    // Account status round-trips through the stored proto variant name.
    assert_eq!(
        acc_1.status.as_known(),
        Some(AccountStatus::Confirmed),
        "confirmed account round-trips"
    );
    assert_eq!(
        acc_2.status.as_known(),
        Some(AccountStatus::Requested),
        "requested account round-trips"
    );

    let projects = list_projects(&svc).await.expect("list projects");
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .expect("project listed");
    assert_eq!(
        project.accounts.len(),
        2,
        "accounts embedded in the list response"
    );

    let by_name: std::collections::HashMap<&str, &Account> = project
        .accounts
        .iter()
        .map(|a| (a.name.as_str(), a))
        .collect();
    let requested = by_name["Requested Lead"];
    assert_eq!(requested.status.as_known(), Some(AccountStatus::Requested));
    assert_eq!(requested.start_date.as_deref(), Some("2026-09-01"));
    assert_eq!(requested.end_date.as_deref(), Some("2026-12-31"));
    assert_eq!(requested.budget.as_deref(), Some("80k"));
    assert_eq!(
        by_name["Confirmed Order"].status.as_known(),
        Some(AccountStatus::Confirmed)
    );

    // The project blob itself never carries accounts.
    let blob: Vec<u8> = sqlx::query_scalar("SELECT data FROM project WHERE id = ?1")
        .bind(&project_id)
        .fetch_one(&pool)
        .await
        .expect("fetch project blob");
    let decoded = Project::decode_from_slice(&blob).expect("decode project blob");
    assert!(
        decoded.accounts.is_empty(),
        "accounts must never be stored inside the project blob"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_account_validation_rejections_write_nothing() {
    let (pool, db) = common::temp_pool("accounts").await;
    let svc = ProjectServiceImpl::new(pool.clone(), events::Hub::new());

    let project_id = upsert_project(
        &svc,
        ACTOR,
        Project {
            name: "Project A".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create project")
    .id;
    let change_log_before = change_log_count(&pool).await;

    let mut invalid = vec![
        // Empty name.
        Account {
            project_id: project_id.clone(),
            name: "   ".to_string(),
            status: AccountStatus::Confirmed.into(),
            ..Default::default()
        },
        // Unspecified status.
        Account {
            project_id: project_id.clone(),
            name: "No status".to_string(),
            status: AccountStatus::Unspecified.into(),
            ..Default::default()
        },
        // Malformed start date.
        Account {
            project_id: project_id.clone(),
            name: "Bad date".to_string(),
            status: AccountStatus::Confirmed.into(),
            start_date: Some("01.09.2026".to_string()),
            ..Default::default()
        },
        // Malformed end date.
        Account {
            project_id: project_id.clone(),
            name: "Bad end date".to_string(),
            status: AccountStatus::Confirmed.into(),
            end_date: Some("2026/12/31".to_string()),
            ..Default::default()
        },
        // end before start.
        Account {
            project_id: project_id.clone(),
            name: "Reversed range".to_string(),
            status: AccountStatus::Confirmed.into(),
            start_date: Some("2027-01-01".to_string()),
            end_date: Some("2026-01-01".to_string()),
            ..Default::default()
        },
        // Budget too long.
        Account {
            project_id: project_id.clone(),
            name: "Big budget".to_string(),
            status: AccountStatus::Confirmed.into(),
            budget: Some("x".repeat(65)),
            ..Default::default()
        },
        // Whitespace-only budget.
        Account {
            project_id: project_id.clone(),
            name: "Blank budget".to_string(),
            status: AccountStatus::Confirmed.into(),
            budget: Some("   ".to_string()),
            ..Default::default()
        },
    ];

    for (i, account) in invalid.drain(..).enumerate() {
        let err = upsert_account(&svc, ACTOR, account)
            .await
            .expect_err(&format!("case {i}: invalid account must be rejected"));
        assert_eq!(err.code, ErrorCode::InvalidArgument, "case {i}: code");
    }

    assert_eq!(
        account_row_count(&pool).await,
        0,
        "rejected upserts must write no account rows"
    );
    assert_eq!(
        change_log_count(&pool).await,
        change_log_before,
        "rejected upserts must append no change_log rows"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_account_requires_existing_project() {
    let (pool, db) = common::temp_pool("accounts").await;
    let svc = ProjectServiceImpl::new(pool.clone(), events::Hub::new());

    let change_log_before = change_log_count(&pool).await;
    let err = upsert_account(
        &svc,
        ACTOR,
        Account {
            project_id: "does-not-exist".to_string(),
            name: "Orphan".to_string(),
            status: AccountStatus::Confirmed.into(),
            ..Default::default()
        },
    )
    .await
    .expect_err("account onto a missing project must fail");
    assert_eq!(err.code, ErrorCode::NotFound);
    assert_eq!(account_row_count(&pool).await, 0);
    assert_eq!(
        change_log_count(&pool).await,
        change_log_before,
        "a rejected upsert writes nothing"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_account_unknown_status_rejected() {
    let (pool, db) = common::temp_pool("accounts").await;
    let svc = ProjectServiceImpl::new(pool.clone(), events::Hub::new());

    let project_id = upsert_project(
        &svc,
        ACTOR,
        Project {
            name: "Project A".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create project")
    .id;

    let err = upsert_account(
        &svc,
        ACTOR,
        Account {
            project_id,
            name: "Unknown status".to_string(),
            status: buffa::EnumValue::Unknown(99),
            ..Default::default()
        },
    )
    .await
    .expect_err("unrecognized status must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(account_row_count(&pool).await, 0, "nothing written");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn delete_account_cascades_assignments() {
    let (pool, db) = common::temp_pool("accounts").await;
    let portfolio_svc = ProjectServiceImpl::new(pool.clone(), events::Hub::new());
    let planning_svc = PlanningServiceImpl::new(pool.clone(), events::Hub::new());

    let project_id = upsert_project(
        &portfolio_svc,
        ACTOR,
        Project {
            name: "Project A".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create project")
    .id;

    let acc_1 = upsert_account(
        &portfolio_svc,
        ACTOR,
        Account {
            project_id: project_id.clone(),
            name: "Account 1".to_string(),
            status: AccountStatus::Confirmed.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create account 1");
    let acc_2 = upsert_account(
        &portfolio_svc,
        ACTOR,
        Account {
            project_id: project_id.clone(),
            name: "Account 2".to_string(),
            status: AccountStatus::Confirmed.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create account 2");

    let version_id = create_version(
        &planning_svc,
        ACTOR,
        CreateVersionRequest {
            name: "V".to_string(),
            ..Default::default()
        },
    )
    .await
    .expect("create version")
    .meta
    .into_option()
    .unwrap_or_default()
    .id;
    apply_assignments(
        &planning_svc,
        ACTOR,
        ApplyAssignmentsRequest {
            version_id: version_id.clone(),
            upserts: vec![
                Assignment {
                    employee_id: "emp-1".to_string(),
                    project_id: project_id.clone(),
                    account_id: Some(acc_1.id.clone()),
                    date: "2026-09-01".to_string(),
                    allocation: 0.5,
                    ..Default::default()
                },
                Assignment {
                    employee_id: "emp-2".to_string(),
                    project_id: project_id.clone(),
                    account_id: Some(acc_2.id.clone()),
                    date: "2026-09-01".to_string(),
                    allocation: 0.4,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    )
    .await
    .expect("plan onto both accounts");
    assert_eq!(assignment_row_count(&pool, &version_id).await, 2);
    let assignment_events_before = assignment_event_count(&pool).await;

    delete_account(&portfolio_svc, ACTOR, &acc_1.id)
        .await
        .expect("delete account 1");

    // Account 1 is gone; account 2 remains.
    assert_eq!(account_row_count(&pool).await, 1);
    assert_eq!(
        assignment_count_by_account(&pool, &acc_1.id).await,
        0,
        "assignments onto the deleted account cascade away"
    );
    assert_eq!(
        assignment_count_by_account(&pool, &acc_2.id).await,
        1,
        "assignments onto the surviving account are untouched"
    );
    assert_eq!(assignment_row_count(&pool, &version_id).await, 1);

    // The delete is announced as an ACCOUNT DELETE event (version_id None)
    // and — cascade being a database-level effect — no assignment events.
    let (kind, op, entity_id, version_id_col): (i32, i32, String, Option<String>) = sqlx::query_as(
        "SELECT kind, op, entity_id, version_id FROM change_log ORDER BY seq DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("fetch latest change_log row");
    assert_eq!(kind, EntityKind::Account.to_i32());
    assert_eq!(op, ChangeOp::Delete.to_i32());
    assert_eq!(entity_id, acc_1.id);
    assert_eq!(
        version_id_col, None,
        "account events are not scoped to a plan version"
    );
    assert_eq!(
        assignment_event_count(&pool).await,
        assignment_events_before,
        "cascaded assignment rows are not announced as assignment events"
    );

    // Deleting a missing account is NotFound and writes nothing.
    let before = change_log_count(&pool).await;
    let err = delete_account(&portfolio_svc, ACTOR, &acc_1.id)
        .await
        .expect_err("repeat delete must be NotFound");
    assert_eq!(err.code, ErrorCode::NotFound);
    assert_eq!(change_log_count(&pool).await, before);

    db.cleanup(pool).await;
}
