//! `AdminService`: account and role administration, restricted to callers
//! holding `USER_ROLE_ADMIN` — see `auth::require_role`, called first thing
//! in every handler here.
//!
//! Deliberately does **not** go through `services::crud`: `users` is a
//! typed-column table, not a plain `id`/`updated_at`/`data` blob table (see
//! `services::growth`'s module doc for the same distinction), and there is
//! no "server assigns an id" concept here — `email` is the caller-supplied
//! primary key.
//!
//! Also deliberately does **not** write `change_log` rows or publish
//! anything through `Hub`: `Hub::publish_all` fans every event out to
//! *every* connected client (see `events`'s module doc), and a user/role
//! administration event would push every email address and role
//! assignment change into every employee's browser. So this module talks
//! to the `users` table directly and stops there — no event, by design,
//! not because publishing was forgotten.

use buffa::EnumValue;
use connectrpc::{ConnectError, ErrorCode, RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth::{self, CurrentUser};
use crate::error::{AppError, AppResult};
use crate::proto::admin::{
    AdminService, DeleteUserRequest, DeleteUserResponse, ListUsersRequest, ListUsersResponse,
    UpsertUserRequest, UpsertUserResponse,
};
use crate::proto::session::{User, UserRole};
use crate::services::session::user_from_fields;

pub struct AdminServiceImpl {
    pool: SqlitePool,
}

impl AdminServiceImpl {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

impl AdminService for AdminServiceImpl {
    async fn list_users(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListUsersRequest>,
    ) -> ServiceResult<ListUsersResponse> {
        let _current = auth::require_role(&ctx, UserRole::Admin)?;
        let users = list_all(&self.pool).await?;
        Response::ok(ListUsersResponse {
            users,
            ..Default::default()
        })
    }

    async fn upsert_user(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertUserRequest>,
    ) -> ServiceResult<UpsertUserResponse> {
        let _current = auth::require_role(&ctx, UserRole::Admin)?;
        let user = do_upsert(&self.pool, request.to_owned_message()).await?;
        Response::ok(UpsertUserResponse {
            user: user.into(),
            ..Default::default()
        })
    }

    async fn delete_user(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteUserRequest>,
    ) -> ServiceResult<DeleteUserResponse> {
        let current = auth::require_role(&ctx, UserRole::Admin)?;
        do_delete(&self.pool, &current, request.email).await?;
        Response::ok(DeleteUserResponse::default())
    }
}

/// List every `users` row as a `User`, ordered by email for a stable UI —
/// built through the same `user_from_fields` helper `SessionService` uses,
/// so the two surfaces never drift apart.
async fn list_all(pool: &SqlitePool) -> AppResult<Vec<User>> {
    let rows: Vec<(String, String, String, Option<String>)> =
        sqlx::query_as("SELECT email, name, roles, employee_id FROM users ORDER BY email")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(email, name, roles_raw, employee_id)| {
            let roles = auth::roles_from_db(&roles_raw);
            user_from_fields(&email, &name, &roles, employee_id)
        })
        .collect())
}

/// `email` must be non-empty and look like an email address; `roles` must
/// be non-empty and contain no `USER_ROLE_UNSPECIFIED` (nor any value this
/// build of the enum doesn't recognize at all, which is just as
/// meaningless to store).
fn validate_upsert(request: &UpsertUserRequest) -> AppResult<()> {
    if request.email.trim().is_empty() || !request.email.contains('@') {
        return Err(AppError::InvalidArgument(
            "email must be non-empty and contain '@'".to_string(),
        ));
    }
    if request.roles.is_empty() {
        return Err(AppError::InvalidArgument(
            "a user must have at least one role".to_string(),
        ));
    }
    for role in &request.roles {
        if !matches!(role.as_known(), Some(known) if known != UserRole::Unspecified) {
            return Err(AppError::InvalidArgument(
                "roles must not include USER_ROLE_UNSPECIFIED".to_string(),
            ));
        }
    }
    Ok(())
}

/// Create the `users` row if `request.email` is unseen (`name = email` as a
/// placeholder until the person's first login supplies the real one,
/// `created_at` now), or update its `roles`/`employee_id` if it already
/// exists. Never writes `name`/`subject` — those are login-derived (see
/// `UpsertUserRequest`'s doc comment) and would otherwise be silently
/// overwritten again on the person's next login anyway.
async fn do_upsert(pool: &SqlitePool, request: UpsertUserRequest) -> AppResult<User> {
    validate_upsert(&request)?;
    let roles: Vec<UserRole> = request.roles.iter().filter_map(EnumValue::as_known).collect();
    let canonical = auth::roles_to_db(&roles);

    sqlx::query(
        "INSERT INTO users (email, name, subject, roles, employee_id, created_at)
         VALUES (?1, ?1, NULL, ?2, ?3, ?4)
         ON CONFLICT(email) DO UPDATE SET roles = excluded.roles, employee_id = excluded.employee_id",
    )
    .bind(&request.email)
    .bind(&canonical)
    .bind(request.employee_id.as_deref())
    .bind(now_millis())
    .execute(pool)
    .await?;

    let (name, employee_id): (String, Option<String>) =
        sqlx::query_as("SELECT name, employee_id FROM users WHERE email = ?1")
            .bind(&request.email)
            .fetch_one(pool)
            .await?;

    Ok(user_from_fields(&request.email, &name, &roles, employee_id))
}

/// Delete the `users` row for `email`. `NotFound` if no row matched;
/// `FailedPrecondition` if `email` is the caller's own account, or the last
/// remaining account holding `USER_ROLE_ADMIN` — either one would leave the
/// instance with nobody able to call `AdminService` again, and there is no
/// recovery path for that short of hand-editing the database.
async fn do_delete(pool: &SqlitePool, current: &CurrentUser, email: &str) -> Result<(), ConnectError> {
    if email.eq_ignore_ascii_case(&current.email) {
        return Err(ConnectError::new(
            ErrorCode::FailedPrecondition,
            "cannot delete your own account",
        ));
    }

    let mut tx = pool.begin().await.map_err(AppError::from)?;

    let all: Vec<(String, String)> = sqlx::query_as("SELECT email, roles FROM users")
        .fetch_all(&mut *tx)
        .await
        .map_err(AppError::from)?;

    let Some((_, target_roles_raw)) = all.iter().find(|(row_email, _)| row_email == email) else {
        return Err(AppError::NotFound("user", email.to_string()).into());
    };

    if auth::roles_from_db(target_roles_raw).contains(&UserRole::Admin) {
        let remaining_admins = all
            .iter()
            .filter(|(row_email, roles_raw)| row_email != email && auth::roles_from_db(roles_raw).contains(&UserRole::Admin))
            .count();
        if remaining_admins == 0 {
            return Err(ConnectError::new(
                ErrorCode::FailedPrecondition,
                "cannot delete the last remaining admin",
            ));
        }
    }

    sqlx::query("DELETE FROM users WHERE email = ?1")
        .bind(email)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from)?;

    tx.commit().await.map_err(AppError::from)?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
