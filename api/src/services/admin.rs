//! `AdminService`: account and role administration, application settings,
//! and system monitoring, restricted to callers holding `USER_ROLE_ADMIN` —
//! see `auth::require_role`, called first thing in every handler here.
//!
//! Deliberately does **not** go through `services::crud`: `users` is a
//! typed-column table, not a plain `id`/`updated_at`/`data` blob table (see
//! `services::growth`'s module doc for the same distinction), and there is
//! no "server assigns an id" concept here — `email` is the caller-supplied
//! primary key.
//!
//! Also deliberately does **not** write `change_log` rows or publish
//! anything through `Hub` — not for user/role administration, and not for
//! the `settings.*` overrides `UpdateAppSettings` writes either:
//! `Hub::publish_all` fans every event out to *every* connected client (see
//! `events`'s module doc), and an administration event would push every
//! email address, role assignment, and instance-wide configuration change
//! into every employee's browser. Admin data is also not entity state a
//! client incrementally syncs — the admin UI simply re-reads it via the
//! RPCs below. So this module talks to the `users`/`meta` tables directly
//! and stops there — no event, by design, not because publishing was
//! forgotten.

use buffa::EnumValue;
use connectrpc::{
    ConnectError, ErrorCode, RequestContext, Response, ServiceRequest, ServiceResult,
};
use sqlx::SqlitePool;

use crate::auth::{self, CurrentUser};
use crate::error::{AppError, AppResult};
use crate::events::Hub;
use crate::proto::admin::{
    AdminService, AppSettings, ChangeLogStats, DeleteUserRequest, DeleteUserResponse, EntityCounts,
    GetAppSettingsRequest, GetAppSettingsResponse, GetSystemStatusRequest, GetSystemStatusResponse,
    ListUsersRequest, ListUsersResponse, SystemStatus, UpdateAppSettingsRequest,
    UpdateAppSettingsResponse, UpsertUserRequest, UpsertUserResponse,
};
use crate::proto::session::{User, UserRole};
use crate::services::session::user_from_fields;
use crate::settings;
use crate::time::now_millis;

pub struct AdminServiceImpl {
    pool: SqlitePool,
    /// Live-event hub, read only for its subscriber count in
    /// `GetSystemStatus` — never published to (see the module doc).
    hub: Hub,
    /// Process start time, captured once at startup in `main`.
    started_at_millis: i64,
    /// The configured database path (`QFC_DB_PATH`), surfaced verbatim by
    /// `GetSystemStatus`.
    db_path: String,
    /// Whether `QFC_DEV_USER` is set — must never be true in production, so
    /// `GetSystemStatus` exposes it for monitoring to flag.
    dev_user_mode: bool,
    /// Startup-environment role-seeding values (`QFC_DEFAULT_ROLE` /
    /// `QFC_ADMIN_EMAILS`): the fallback `settings::effective` resolves
    /// against, and the `environment` half `GetAppSettings` reports.
    env_default_role: UserRole,
    env_admin_emails: Vec<String>,
}

/// Everything [`AdminServiceImpl::new`] needs beyond the pool — grouped
/// into a struct so the constructor takes two arguments instead of seven.
pub struct AdminServiceConfig {
    pub hub: Hub,
    pub started_at_millis: i64,
    pub db_path: String,
    pub dev_user_mode: bool,
    pub env_default_role: UserRole,
    pub env_admin_emails: Vec<String>,
}

impl AdminServiceImpl {
    pub fn new(pool: SqlitePool, config: AdminServiceConfig) -> Self {
        Self {
            pool,
            hub: config.hub,
            started_at_millis: config.started_at_millis,
            db_path: config.db_path,
            dev_user_mode: config.dev_user_mode,
            env_default_role: config.env_default_role,
            env_admin_emails: config.env_admin_emails,
        }
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

    async fn get_app_settings(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, GetAppSettingsRequest>,
    ) -> ServiceResult<GetAppSettingsResponse> {
        let _current = auth::require_role(&ctx, UserRole::Admin)?;
        let (default_role, admin_emails, default_role_overridden, admin_emails_overridden) =
            settings::effective(&self.pool, self.env_default_role, &self.env_admin_emails).await?;
        Response::ok(GetAppSettingsResponse {
            effective: app_settings(default_role, admin_emails).into(),
            environment: app_settings(self.env_default_role, self.env_admin_emails.clone()).into(),
            default_role_overridden,
            admin_emails_overridden,
            ..Default::default()
        })
    }

    async fn update_app_settings(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpdateAppSettingsRequest>,
    ) -> ServiceResult<UpdateAppSettingsResponse> {
        let _current = auth::require_role(&ctx, UserRole::Admin)?;
        let request = request.to_owned_message();
        let settings_msg = request.settings.into_option().unwrap_or_default();
        // An enum value this build doesn't recognize at all is just as
        // meaningless to store as USER_ROLE_UNSPECIFIED — both fall into
        // `settings::update`'s rejection below.
        let default_role = settings_msg
            .default_role
            .as_known()
            .unwrap_or(UserRole::Unspecified);
        settings::update(&self.pool, default_role, &settings_msg.admin_emails).await?;
        // Re-read through `effective` rather than echoing the request back:
        // the response then provably shows what a reader would now see
        // (normalized values, environment fallback semantics included).
        let (default_role, admin_emails, _, _) =
            settings::effective(&self.pool, self.env_default_role, &self.env_admin_emails).await?;
        Response::ok(UpdateAppSettingsResponse {
            effective: app_settings(default_role, admin_emails).into(),
            ..Default::default()
        })
    }

    async fn get_system_status(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, GetSystemStatusRequest>,
    ) -> ServiceResult<GetSystemStatusResponse> {
        let _current = auth::require_role(&ctx, UserRole::Admin)?;
        let entities = entity_counts(&self.pool).await?;
        let change_log = change_log_stats(&self.pool).await?;
        // SQLite reports the database size as whole pages only; the file
        // size on disk is exactly page_count * page_size (plus WAL content
        // not yet checkpointed, which this deliberately ignores — a steady
        // state figure is what monitoring wants, not a WAL-noise-heavy one).
        let page_count: i64 = sqlx::query_scalar("PRAGMA page_count")
            .fetch_one(&self.pool)
            .await
            .map_err(AppError::from)?;
        let page_size: i64 = sqlx::query_scalar("PRAGMA page_size")
            .fetch_one(&self.pool)
            .await
            .map_err(AppError::from)?;
        Response::ok(GetSystemStatusResponse {
            status: SystemStatus {
                server_started_at_millis: self.started_at_millis,
                server_time_millis: now_millis(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                db_path: self.db_path.clone(),
                db_size_bytes: page_count * page_size,
                dev_user_mode: self.dev_user_mode,
                active_watch_subscriptions: self.hub.active_subscriptions() as i64,
                entities: entities.into(),
                change_log: change_log.into(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        })
    }
}

/// Build the wire `AppSettings` from a resolved (or environment) value
/// pair — one place so `effective` and `environment` can never drift in
/// shape.
fn app_settings(default_role: UserRole, admin_emails: Vec<String>) -> AppSettings {
    AppSettings {
        default_role: default_role.into(),
        admin_emails,
        ..Default::default()
    }
}

/// `COUNT(*)` of one table whose name is a hand-written literal at the
/// single call site below — never caller input, so interpolating it into
/// SQL is safe (the `AssertSqlSafe` audit marker sqlx 0.9 requires for a
/// dynamically built query string, same pattern as `store`).
async fn count_rows(pool: &SqlitePool, table: &'static str) -> AppResult<i64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .fetch_one(pool)
        .await?)
}

/// Row counts of every entity table, for `GetSystemStatus`. The names are
/// fixed literals from `migrations/0001_init.sql`: the five blob tables
/// (`store::Table`) plus the typed-column tables — all static, so there is
/// no user input anywhere near the SQL.
async fn entity_counts(pool: &SqlitePool) -> AppResult<EntityCounts> {
    Ok(EntityCounts {
        users: count_rows(pool, "users").await?,
        employees: count_rows(pool, "employee").await?,
        customers: count_rows(pool, "customer").await?,
        projects: count_rows(pool, "project").await?,
        plan_versions: count_rows(pool, "plan_version").await?,
        assignments: count_rows(pool, "assignment").await?,
        absences: count_rows(pool, "absence").await?,
        quarter_data: count_rows(pool, "quarter_data").await?,
        strategic_goals: count_rows(pool, "strategic_goal").await?,
        north_star_metrics: count_rows(pool, "north_star").await?,
        one_on_one_sessions: count_rows(pool, "one_on_one").await?,
        public_holidays: count_rows(pool, "public_holiday").await?,
        ..Default::default()
    })
}

/// `change_log` occupancy and the retention cap it is pruned to, for
/// `GetSystemStatus`. `MIN`/`MAX(seq)` are 0 (not `NULL`) on an empty log,
/// matching the proto's documented "0 when the log is empty" semantics.
async fn change_log_stats(pool: &SqlitePool) -> AppResult<ChangeLogStats> {
    let (rows, oldest_seq, newest_seq): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(MIN(seq), 0), COALESCE(MAX(seq), 0) FROM change_log",
    )
    .fetch_one(pool)
    .await?;
    Ok(ChangeLogStats {
        rows,
        oldest_seq,
        newest_seq,
        retention_rows: crate::events::retention_rows(),
        ..Default::default()
    })
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
    let roles: Vec<UserRole> = request
        .roles
        .iter()
        .filter_map(EnumValue::as_known)
        .collect();
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
async fn do_delete(
    pool: &SqlitePool,
    current: &CurrentUser,
    email: &str,
) -> Result<(), ConnectError> {
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
            .filter(|(row_email, roles_raw)| {
                row_email != email && auth::roles_from_db(roles_raw).contains(&UserRole::Admin)
            })
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
