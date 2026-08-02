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
use qfc_api::proto::admin::{AdminService, DeleteUserRequest, ListUsersRequest, UpsertUserRequest};
use qfc_api::proto::session::{User, UserRole};
use qfc_api::services::admin::AdminServiceImpl;
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
    let svc = AdminServiceImpl::new(pool.clone());

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

    db.cleanup(pool).await;
}

#[tokio::test]
async fn admin_caller_can_list_upsert_and_delete() {
    let (pool, db) = common::temp_pool("admin").await;
    let svc = AdminServiceImpl::new(pool.clone());
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
    let svc = AdminServiceImpl::new(pool.clone());
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
    let svc = AdminServiceImpl::new(pool.clone());

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
    let svc = AdminServiceImpl::new(pool.clone());

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
    let svc = AdminServiceImpl::new(pool.clone());
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
    let svc = AdminServiceImpl::new(pool.clone());
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
    let svc = AdminServiceImpl::new(pool.clone());

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
