//! Integration tests for `AdminService` and the multi-role user pipeline it
//! sits in front of (`auth::require_role`, `auth::ensure_admins`, and the
//! pre-creation property `auth::middleware` relies on), in the style of
//! `tests/master_data.rs`: each test gets its own temp SQLite file (migrated
//! fresh by `qfc_api::db::connect`) and cleans it up (including WAL sidecar
//! files) on the way out.

mod common;

use std::sync::Arc;

use buffa::Message;
use buffa::view::HasMessageView;
use bytes::Bytes;
use connectrpc::{ConnectError, ErrorCode, RequestContext, ServiceRequest};
use qfc_api::auth::{self, CurrentUser};
use qfc_api::events::{self, Hub};
use qfc_api::proto::admin::{
    AdminService, AppSettings, DeleteUserRequest, GetAppSettingsRequest, GetAppSettingsResponse,
    GetSystemStatusRequest, ListUsersRequest, SystemStatus, UpdateAppSettingsRequest,
    UpdateAppSettingsResponse, UpsertUserRequest,
};
use qfc_api::proto::events::{ChangeOp, EntityKind};
use qfc_api::proto::session::{User, UserRole};
use qfc_api::proto::team;
use qfc_api::services::admin::{AdminServiceConfig, AdminServiceImpl};
use qfc_api::store;
use sqlx::SqlitePool;
use tokio::sync::Mutex;

/// A `RequestContext` carrying `email`/`roles` as the authenticated caller,
/// the way `auth::middleware` would have set it up upstream of the handler.
fn ctx_for(email: &str, roles: Vec<UserRole>) -> RequestContext {
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

/// A service over `pool` with an environment-only settings baseline
/// (employee default, no seed admins, no dev-user mode) and a fixed
/// `started_at` so uptime assertions stay deterministic — tests that care
/// about specific environment values build their own `AdminServiceConfig`.
fn svc(pool: &SqlitePool) -> AdminServiceImpl {
    svc_with(
        pool,
        AdminServiceConfig {
            hub: Hub::new(),
            started_at_millis: 1_000,
            db_path: "test.db".to_string(),
            dev_user_mode: false,
            env_default_role: UserRole::Employee,
            env_admin_emails: vec![],
        },
    )
}

fn svc_with(pool: &SqlitePool, config: AdminServiceConfig) -> AdminServiceImpl {
    AdminServiceImpl::new(pool.clone(), config)
}

async fn list_users(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
) -> Result<Vec<User>, ConnectError> {
    let body = Bytes::from(ListUsersRequest::default().encode_to_vec());
    let view = ListUsersRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<ListUsersRequest>::from_parts(&view, &body);
    let resp = svc.list_users(ctx, req).await?;
    Ok(resp.body.users)
}

async fn upsert_user(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
    request: UpsertUserRequest,
) -> Result<User, ConnectError> {
    let body = Bytes::from(request.encode_to_vec());
    let view = UpsertUserRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpsertUserRequest>::from_parts(&view, &body);
    let resp = svc.upsert_user(ctx, req).await?;
    Ok(resp.body.user.into_option().unwrap_or_default())
}

async fn delete_user(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
    email: &str,
) -> Result<(), ConnectError> {
    let body = Bytes::from(
        DeleteUserRequest {
            email: email.to_string(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = DeleteUserRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<DeleteUserRequest>::from_parts(&view, &body);
    svc.delete_user(ctx, req).await?;
    Ok(())
}

async fn get_app_settings(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
) -> Result<GetAppSettingsResponse, ConnectError> {
    let body = Bytes::from(GetAppSettingsRequest::default().encode_to_vec());
    let view = GetAppSettingsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<GetAppSettingsRequest>::from_parts(&view, &body);
    let resp = svc.get_app_settings(ctx, req).await?;
    Ok(resp.body)
}

async fn update_app_settings(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
    settings: AppSettings,
) -> Result<UpdateAppSettingsResponse, ConnectError> {
    let body = Bytes::from(
        UpdateAppSettingsRequest {
            settings: settings.into(),
            ..Default::default()
        }
        .encode_to_vec(),
    );
    let view = UpdateAppSettingsRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<UpdateAppSettingsRequest>::from_parts(&view, &body);
    let resp = svc.update_app_settings(ctx, req).await?;
    Ok(resp.body)
}

async fn get_system_status(
    svc: &AdminServiceImpl,
    ctx: RequestContext,
) -> Result<SystemStatus, ConnectError> {
    let body = Bytes::from(GetSystemStatusRequest::default().encode_to_vec());
    let view = GetSystemStatusRequest::decode_view(&body).expect("decode view");
    let req = ServiceRequest::<GetSystemStatusRequest>::from_parts(&view, &body);
    let resp = svc.get_system_status(ctx, req).await?;
    Ok(resp.body.status.into_option().unwrap_or_default())
}

/// The `(default_role, admin_emails)` of an [`AppSettings`] message as
/// plain values, for direct assertion.
fn settings_parts(settings: AppSettings) -> (UserRole, Vec<String>) {
    (
        settings
            .default_role
            .as_known()
            .unwrap_or(UserRole::Unspecified),
        settings.admin_emails,
    )
}

async fn meta_value(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM meta WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .expect("read meta value")
}

/// Commit one `Employee` upsert with its `change_log` entry, the way a
/// business service would (row + log atomically), so `GetSystemStatus`
/// tests observe a real mutation rather than a hand-crafted log row.
async fn write_employee(pool: &SqlitePool, id: &str) {
    let employee = team::Employee::default();
    let mut tx = pool.begin().await.expect("begin tx");
    store::upsert_blob(&mut tx, store::Table::Employee, id, &employee)
        .await
        .expect("upsert_blob");
    events::record(
        &mut tx,
        "test@example.com",
        EntityKind::Employee,
        ChangeOp::Upsert,
        id,
        None,
        Some(employee.encode_to_vec()),
    )
    .await
    .expect("record change event");
    tx.commit().await.expect("commit");
}

async fn user_row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .expect("count users rows")
}

async fn stored_roles(pool: &SqlitePool, email: &str) -> Vec<UserRole> {
    let raw: String = sqlx::query_scalar("SELECT roles FROM users WHERE email = ?1")
        .bind(email)
        .fetch_one(pool)
        .await
        .expect("fetch stored roles");
    auth::roles_from_db(&raw)
}

/// Drive `auth::middleware` for `header_email`/`header_name` through a tiny
/// axum app (the same wiring `main.rs` layers in front of the real router)
/// and capture the `CurrentUser` it attaches, without going through a real
/// HTTP server or reaching into `auth`'s private `upsert_and_load`.
async fn current_user_via_middleware(
    pool: &SqlitePool,
    admin_emails: &[String],
    header_email: &str,
    header_name: &str,
) -> CurrentUser {
    let auth_state = auth::AuthState {
        pool: pool.clone(),
        dev_user: None,
        default_role: UserRole::Employee,
        admin_emails: admin_emails.to_vec(),
    };

    let captured: Arc<Mutex<Option<CurrentUser>>> = Arc::new(Mutex::new(None));
    let captured_for_handler = captured.clone();

    let app = axum::Router::new()
        .route(
            "/probe",
            axum::routing::get(
                move |axum::extract::Extension(current): axum::extract::Extension<CurrentUser>| {
                    let captured = captured_for_handler.clone();
                    async move {
                        *captured.lock().await = Some(current);
                        axum::http::StatusCode::OK
                    }
                },
            ),
        )
        .layer(axum::middleware::from_fn_with_state(
            auth_state,
            auth::middleware,
        ));

    let request = http::Request::builder()
        .uri("/probe")
        .header("x-auth-request-email", header_email)
        .header("x-auth-request-name", header_name)
        .body(axum::body::Body::empty())
        .expect("build probe request");

    let response = tower::ServiceExt::oneshot(app, request)
        .await
        .expect("drive middleware");
    assert_eq!(
        response.status(),
        http::StatusCode::OK,
        "probe handler must be reached"
    );

    captured
        .lock()
        .await
        .take()
        .expect("middleware must have attached a CurrentUser")
}

#[tokio::test]
async fn non_admin_caller_gets_permission_denied_from_every_rpc() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);

    let err = list_users(&svc, ctx_for("caller@example.com", vec![UserRole::Pm]))
        .await
        .expect_err("ListUsers must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = upsert_user(
        &svc,
        ctx_for("caller@example.com", vec![UserRole::Pm]),
        UpsertUserRequest {
            email: "new@example.com".to_string(),
            roles: vec![UserRole::Pm.into()],
            ..Default::default()
        },
    )
    .await
    .expect_err("UpsertUser must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = delete_user(
        &svc,
        ctx_for("caller@example.com", vec![UserRole::Pm]),
        "someone@example.com",
    )
    .await
    .expect_err("DeleteUser must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = get_app_settings(&svc, ctx_for("caller@example.com", vec![UserRole::Pm]))
        .await
        .expect_err("GetAppSettings must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = update_app_settings(
        &svc,
        ctx_for("caller@example.com", vec![UserRole::Pm]),
        AppSettings {
            default_role: UserRole::Pm.into(),
            ..Default::default()
        },
    )
    .await
    .expect_err("UpdateAppSettings must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    let err = get_system_status(&svc, ctx_for("caller@example.com", vec![UserRole::Pm]))
        .await
        .expect_err("GetSystemStatus must be denied for a non-admin");
    assert_eq!(err.code, ErrorCode::PermissionDenied);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn admin_caller_can_list_upsert_and_delete() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);
    let admin_ctx = || ctx_for("admin@example.com", vec![UserRole::Admin]);

    let created = upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "newhire@example.com".to_string(),
            roles: vec![UserRole::Pm.into()],
            employee_id: Some("emp-1".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("admin upsert must succeed");
    assert_eq!(created.email, "newhire@example.com");
    assert_eq!(created.roles, vec![buffa::EnumValue::Known(UserRole::Pm)]);
    assert_eq!(created.employee_id.as_deref(), Some("emp-1"));

    let listed = list_users(&svc, admin_ctx())
        .await
        .expect("admin list must succeed");
    assert!(listed.iter().any(|u| u.email == "newhire@example.com"));

    delete_user(&svc, admin_ctx(), "newhire@example.com")
        .await
        .expect("admin delete of a non-admin user must succeed");
    assert_eq!(user_row_count(&pool).await, 0);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn upsert_with_empty_roles_is_invalid_argument_and_writes_nothing() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);
    let rows_before = user_row_count(&pool).await;

    let err = upsert_user(
        &svc,
        ctx_for("admin@example.com", vec![UserRole::Admin]),
        UpsertUserRequest {
            email: "nobody@example.com".to_string(),
            roles: vec![],
            ..Default::default()
        },
    )
    .await
    .expect_err("empty roles must be rejected");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(
        user_row_count(&pool).await,
        rows_before,
        "rejected upsert must not write a row"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn pre_creation_then_first_login_carries_the_admin_assigned_roles() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);

    upsert_user(
        &svc,
        ctx_for("admin@example.com", vec![UserRole::Admin]),
        UpsertUserRequest {
            email: "precreated@example.com".to_string(),
            roles: vec![UserRole::Pm.into(), UserRole::Admin.into()],
            ..Default::default()
        },
    )
    .await
    .expect("pre-creation upsert must succeed");

    let current =
        current_user_via_middleware(&pool, &[], "precreated@example.com", "Pre Created").await;

    assert_eq!(
        current.roles,
        vec![UserRole::Admin, UserRole::Pm],
        "first login must carry the admin-assigned roles in canonical order, not the employee default"
    );
    assert_eq!(
        current.name, "Pre Created",
        "first login must still supply the real name"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn later_login_updates_name_but_leaves_roles_untouched() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);

    upsert_user(
        &svc,
        ctx_for("admin@example.com", vec![UserRole::Admin]),
        UpsertUserRequest {
            email: "returning@example.com".to_string(),
            roles: vec![UserRole::Bl.into()],
            ..Default::default()
        },
    )
    .await
    .expect("pre-creation upsert must succeed");

    let first =
        current_user_via_middleware(&pool, &[], "returning@example.com", "First Name").await;
    assert_eq!(first.name, "First Name");
    assert_eq!(first.roles, vec![UserRole::Bl]);

    let second =
        current_user_via_middleware(&pool, &[], "returning@example.com", "Updated Name").await;
    assert_eq!(
        second.name, "Updated Name",
        "a later login must refresh the name"
    );
    assert_eq!(
        second.roles,
        vec![UserRole::Bl],
        "a later login must never touch admin-managed roles"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn deleting_the_last_admin_is_refused_but_a_non_admin_can_be_deleted() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);
    // The calling operator is authenticated via a synthetic admin context
    // (as every other test here does) and deliberately has no `users` row
    // of its own, so it never interferes with the "last remaining admin"
    // count below.
    let admin_ctx = || ctx_for("operator@example.com", vec![UserRole::Admin]);

    upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "solo-admin@example.com".to_string(),
            roles: vec![UserRole::Admin.into()],
            ..Default::default()
        },
    )
    .await
    .expect("create solo admin");
    upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "pm-user@example.com".to_string(),
            roles: vec![UserRole::Pm.into()],
            ..Default::default()
        },
    )
    .await
    .expect("create pm user");

    let err = delete_user(&svc, admin_ctx(), "solo-admin@example.com")
        .await
        .expect_err("deleting the last remaining admin must be refused");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    delete_user(&svc, admin_ctx(), "pm-user@example.com")
        .await
        .expect("deleting a non-admin user must succeed");

    let listed = list_users(&svc, admin_ctx()).await.expect("list ok");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].email, "solo-admin@example.com");

    db.cleanup(pool).await;
}

#[tokio::test]
async fn admin_cannot_delete_their_own_account() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);
    let admin_ctx = || ctx_for("self@example.com", vec![UserRole::Admin]);

    upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "self@example.com".to_string(),
            roles: vec![UserRole::Admin.into()],
            ..Default::default()
        },
    )
    .await
    .expect("create own row");

    let err = delete_user(&svc, admin_ctx(), "self@example.com")
        .await
        .expect_err("an admin must not be able to delete their own account");
    assert_eq!(err.code, ErrorCode::FailedPrecondition);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn ensure_admins_is_idempotent_and_does_not_clobber_existing_extra_roles() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);

    upsert_user(
        &svc,
        ctx_for("admin@example.com", vec![UserRole::Admin]),
        UpsertUserRequest {
            email: "will-become-admin@example.com".to_string(),
            roles: vec![UserRole::Pm.into()],
            ..Default::default()
        },
    )
    .await
    .expect("seed a PM-only user");

    let admin_emails = vec!["will-become-admin@example.com".to_string()];
    auth::ensure_admins(&pool, &admin_emails)
        .await
        .expect("ensure_admins ok");
    assert_eq!(
        stored_roles(&pool, "will-become-admin@example.com").await,
        vec![UserRole::Admin, UserRole::Pm]
    );

    // Idempotent: running it again must not duplicate or otherwise change
    // the outcome.
    auth::ensure_admins(&pool, &admin_emails)
        .await
        .expect("ensure_admins ok (second call)");
    assert_eq!(
        stored_roles(&pool, "will-become-admin@example.com").await,
        vec![UserRole::Admin, UserRole::Pm]
    );
    assert_eq!(user_row_count(&pool).await, 1);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn ensure_admins_creates_a_placeholder_row_for_a_never_seen_email() {
    let (pool, db) = common::temp_pool("admin").await;

    let admin_emails = vec!["brand-new-admin@example.com".to_string()];
    auth::ensure_admins(&pool, &admin_emails)
        .await
        .expect("ensure_admins ok");

    assert_eq!(
        stored_roles(&pool, "brand-new-admin@example.com").await,
        vec![UserRole::Admin]
    );
    let name: String = sqlx::query_scalar("SELECT name FROM users WHERE email = ?1")
        .bind("brand-new-admin@example.com")
        .fetch_one(&pool)
        .await
        .expect("fetch name");
    assert_eq!(
        name, "brand-new-admin@example.com",
        "placeholder name must be the email itself"
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn update_app_settings_persists_and_get_reflects_db_over_env() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc_with(
        &pool,
        AdminServiceConfig {
            hub: Hub::new(),
            started_at_millis: 1_000,
            db_path: "test.db".to_string(),
            dev_user_mode: false,
            env_default_role: UserRole::Employee,
            env_admin_emails: vec!["env-admin@example.com".to_string()],
        },
    );
    let admin_ctx = || ctx_for("admin@example.com", vec![UserRole::Admin]);

    // Baseline: nothing stored in `meta`, so the environment is effective
    // and nothing is flagged as overridden.
    let baseline = get_app_settings(&svc, admin_ctx())
        .await
        .expect("get baseline settings");
    assert_eq!(
        settings_parts(baseline.effective.into_option().unwrap_or_default()),
        (
            UserRole::Employee,
            vec!["env-admin@example.com".to_string()]
        )
    );
    assert!(!baseline.default_role_overridden);
    assert!(!baseline.admin_emails_overridden);

    let updated = update_app_settings(
        &svc,
        admin_ctx(),
        AppSettings {
            default_role: UserRole::Pm.into(),
            admin_emails: vec![" Boss@Example.com ".to_string()],
            ..Default::default()
        },
    )
    .await
    .expect("update settings");
    assert_eq!(
        settings_parts(updated.effective.into_option().unwrap_or_default()),
        (UserRole::Pm, vec!["boss@example.com".to_string()]),
        "the response must show the normalized values now in effect"
    );

    // Both `meta` keys written (lower-case role name, normalized email
    // list) — the same keys `auth`'s first-seen path reads.
    assert_eq!(
        meta_value(&pool, "settings.default_role").await.as_deref(),
        Some("pm")
    );
    assert_eq!(
        meta_value(&pool, "settings.admin_emails").await.as_deref(),
        Some("boss@example.com")
    );

    let after = get_app_settings(&svc, admin_ctx())
        .await
        .expect("get settings after update");
    assert_eq!(
        settings_parts(after.effective.into_option().unwrap_or_default()),
        (UserRole::Pm, vec!["boss@example.com".to_string()])
    );
    assert_eq!(
        settings_parts(after.environment.into_option().unwrap_or_default()),
        (
            UserRole::Employee,
            vec!["env-admin@example.com".to_string()]
        ),
        "the environment half must keep showing what the override shadows"
    );
    assert!(after.default_role_overridden);
    assert!(after.admin_emails_overridden);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn update_app_settings_rejects_invalid_values_and_writes_nothing() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);
    let admin_ctx = || ctx_for("admin@example.com", vec![UserRole::Admin]);

    for (label, settings) in [
        (
            "admin as default role",
            AppSettings {
                default_role: UserRole::Admin.into(),
                ..Default::default()
            },
        ),
        (
            "unspecified as default role",
            AppSettings {
                default_role: UserRole::Unspecified.into(),
                ..Default::default()
            },
        ),
        (
            "admin email without '@'",
            AppSettings {
                default_role: UserRole::Pm.into(),
                admin_emails: vec!["not-an-email".to_string()],
                ..Default::default()
            },
        ),
    ] {
        let err = update_app_settings(&svc, admin_ctx(), settings)
            .await
            .expect_err(&format!("{label} must be rejected"));
        assert_eq!(err.code, ErrorCode::InvalidArgument, "{label}");
    }

    assert_eq!(
        meta_value(&pool, "settings.default_role").await,
        None,
        "rejected updates must not write either key"
    );
    assert_eq!(meta_value(&pool, "settings.admin_emails").await, None);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn invalid_db_values_fall_back_to_the_environment_per_key() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc_with(
        &pool,
        AdminServiceConfig {
            hub: Hub::new(),
            started_at_millis: 1_000,
            db_path: "test.db".to_string(),
            dev_user_mode: false,
            env_default_role: UserRole::Sales,
            env_admin_emails: vec![],
        },
    );
    let admin_ctx = || ctx_for("admin@example.com", vec![UserRole::Admin]);

    // A hand-edited (or future-version) `meta` row with a role name this
    // build doesn't recognize: warn + fall back, never fail the read.
    sqlx::query("INSERT INTO meta (key, value) VALUES ('settings.default_role', 'bogus')")
        .execute(&pool)
        .await
        .expect("hand-insert bogus role");
    let resp = get_app_settings(&svc, admin_ctx())
        .await
        .expect("get settings with bogus db value");
    let effective = resp.effective.into_option().unwrap_or_default();
    assert_eq!(
        effective.default_role.as_known(),
        Some(UserRole::Sales),
        "an unrecognized stored role must fall back to the environment"
    );
    assert!(!resp.default_role_overridden);

    // `admin` parses fine but is forbidden as a default everywhere — a
    // hand-inserted one must fall back just the same.
    sqlx::query("UPDATE meta SET value = 'admin' WHERE key = 'settings.default_role'")
        .execute(&pool)
        .await
        .expect("set admin as stored default role");
    let resp = get_app_settings(&svc, admin_ctx())
        .await
        .expect("get settings with admin db value");
    assert_eq!(
        resp.effective
            .into_option()
            .unwrap_or_default()
            .default_role
            .as_known(),
        Some(UserRole::Sales)
    );
    assert!(!resp.default_role_overridden);

    // Per-key independence: a valid admin-emails override alongside the
    // invalid default role still takes effect (and is normalized).
    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ('settings.admin_emails', ' Db@Admin.com , x@y.z')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .execute(&pool)
    .await
    .expect("store admin emails override");
    let resp = get_app_settings(&svc, admin_ctx())
        .await
        .expect("get settings with mixed validity");
    assert!(resp.admin_emails_overridden);
    assert_eq!(
        resp.effective
            .into_option()
            .unwrap_or_default()
            .admin_emails,
        vec!["db@admin.com".to_string(), "x@y.z".to_string()]
    );

    db.cleanup(pool).await;
}

#[tokio::test]
async fn get_system_status_reports_plausible_values() {
    let (pool, db) = common::temp_pool("admin").await;
    let hub = Hub::new();
    let svc = svc_with(
        &pool,
        AdminServiceConfig {
            hub: hub.clone(),
            started_at_millis: 1_000,
            db_path: "test.db".to_string(),
            dev_user_mode: true,
            env_default_role: UserRole::Employee,
            env_admin_emails: vec![],
        },
    );
    let admin_ctx = || ctx_for("admin@example.com", vec![UserRole::Admin]);
    // One live Watch subscriber, held for the rest of the test so the
    // subscriber count below observes exactly one receiver.
    let _watch = hub.subscribe();

    upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "one@example.com".to_string(),
            roles: vec![UserRole::Pm.into()],
            ..Default::default()
        },
    )
    .await
    .expect("create user one");
    upsert_user(
        &svc,
        admin_ctx(),
        UpsertUserRequest {
            email: "two@example.com".to_string(),
            roles: vec![UserRole::Bl.into()],
            ..Default::default()
        },
    )
    .await
    .expect("create user two");

    let before = get_system_status(&svc, admin_ctx())
        .await
        .expect("get system status");
    assert!(!before.version.is_empty(), "version must be populated");
    assert!(before.db_size_bytes > 0, "a migrated db occupies pages");
    assert_eq!(before.server_started_at_millis, 1_000);
    assert!(
        before.server_time_millis >= before.server_started_at_millis,
        "server time must not precede the start time"
    );
    assert_eq!(before.db_path, "test.db");
    assert!(before.dev_user_mode);
    assert_eq!(before.active_watch_subscriptions, 1);

    let entities = before.entities.into_option().unwrap_or_default();
    assert_eq!(entities.users, 2);
    assert_eq!(entities.employees, 0);
    assert_eq!(entities.customers, 0);
    assert_eq!(entities.projects, 0);
    assert_eq!(entities.plan_versions, 0);
    assert_eq!(entities.assignments, 0);
    assert_eq!(entities.absences, 0);
    assert_eq!(entities.quarter_data, 0);
    assert_eq!(entities.strategic_goals, 0);
    assert_eq!(entities.north_star_metrics, 0);
    assert_eq!(entities.one_on_one_sessions, 0);
    assert_eq!(entities.public_holidays, 0);

    let change_log = before.change_log.into_option().unwrap_or_default();
    assert_eq!(change_log.rows, 0, "no mutation recorded yet");
    assert_eq!(change_log.oldest_seq, 0);
    assert_eq!(change_log.newest_seq, 0);
    assert_eq!(change_log.retention_rows, 20_000);

    // One real mutation: the entity count and the log grow together.
    write_employee(&pool, "emp-1").await;

    let after = get_system_status(&svc, admin_ctx())
        .await
        .expect("get system status after mutation");
    assert_eq!(
        after.entities.into_option().unwrap_or_default().employees,
        1
    );
    let change_log = after.change_log.into_option().unwrap_or_default();
    assert_eq!(change_log.rows, 1, "the mutation must appear in the log");
    assert!(change_log.oldest_seq >= 1);
    assert_eq!(change_log.newest_seq, change_log.oldest_seq);

    db.cleanup(pool).await;
}

#[tokio::test]
async fn first_seen_users_get_the_db_overridden_default_role() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = svc(&pool);

    // Seen BEFORE the override exists: seeded from the environment
    // (employee, per `current_user_via_middleware`'s AuthState).
    let early = current_user_via_middleware(&pool, &[], "early@example.com", "Early Bird").await;
    assert_eq!(early.roles, vec![UserRole::Employee]);

    update_app_settings(
        &svc,
        ctx_for("admin@example.com", vec![UserRole::Admin]),
        AppSettings {
            default_role: UserRole::Pm.into(),
            admin_emails: vec!["seed-admin@example.com".to_string()],
            ..Default::default()
        },
    )
    .await
    .expect("store default-role override");

    // A brand-new login now seeds from the database override, not the
    // environment; an overridden admin-emails entry seeds admin.
    let late = current_user_via_middleware(&pool, &[], "late@example.com", "Late Comer").await;
    assert_eq!(
        late.roles,
        vec![UserRole::Pm],
        "first-seen seeding must honor the settings.default_role override"
    );
    let seeded_admin =
        current_user_via_middleware(&pool, &[], "seed-admin@example.com", "Seed Admin").await;
    assert_eq!(
        seeded_admin.roles,
        vec![UserRole::Admin],
        "first-seen seeding must honor the settings.admin_emails override"
    );

    // First-seen-only: the override must not retroactively touch users who
    // already exist.
    let early_again =
        current_user_via_middleware(&pool, &[], "early@example.com", "Early Bird").await;
    assert_eq!(
        early_again.roles,
        vec![UserRole::Employee],
        "an existing user's roles are admin-managed and never re-seeded"
    );

    db.cleanup(pool).await;
}
