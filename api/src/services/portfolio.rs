//! `ProjectService`: project master data, stored as encoded-proto blob rows
//! (`store::Table::Project`). See `services::crud` for the shared
//! list/upsert/delete machinery every plain blob-backed entity service uses.
//!
//! Accounts (Beauftragungen) are a separate typed table (`account`) hanging
//! off exactly one project each. They are surfaced as `Project.accounts` on
//! reads (`list_projects`, `upsert_project` responses) but are deliberately
//! **never** stored inside the project blob (`Project.accounts` is stripped
//! before `crud::upsert` encodes the row — see the proto comment on the
//! field), so the blob stays a pure projection of the project table and the
//! account rows stay the single source of truth for accounts.

use buffa::{Enumeration, Message};
use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::{SqliteConnection, SqlitePool};

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::{self, Hub, PendingEvents};
use crate::proto::events::{ChangeOp, EntityKind};
use crate::proto::portfolio::{
    Account, AccountStatus, DeleteAccountRequest, DeleteAccountResponse, DeleteProjectRequest,
    DeleteProjectResponse, ListProjectsRequest, ListProjectsResponse, Project, ProjectService,
    UpsertAccountRequest, UpsertAccountResponse, UpsertProjectRequest, UpsertProjectResponse,
};
use crate::proto::session::UserRole;
use crate::services::crud;
use crate::store::Table;
use crate::time::now_millis;

pub struct ProjectServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl ProjectServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl ProjectService for ProjectServiceImpl {
    async fn list_projects(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListProjectsRequest>,
    ) -> ServiceResult<ListProjectsResponse> {
        let mut projects = crud::list(&self.pool, Table::Project).await?;
        attach_accounts(&self.pool, &mut projects).await?;
        Response::ok(ListProjectsResponse {
            projects,
            ..Default::default()
        })
    }

    async fn upsert_project(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertProjectRequest>,
    ) -> ServiceResult<UpsertProjectResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        let mut entity = request
            .to_owned_message()
            .project
            .into_option()
            .unwrap_or_default();
        // Accounts live in the `account` table, never in the project blob
        // (see the module doc): strip any client-supplied accounts before
        // the blob encode, then re-attach the persisted rows for the
        // response.
        entity.accounts.clear();
        let spec = crud::EntitySpec {
            table: Table::Project,
            kind: EntityKind::Project,
            name: "project",
        };
        let mut project = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |p: &mut Project| &mut p.id,
            validate_project,
        )
        .await?;
        project.accounts = accounts_for_project(&self.pool, &project.id).await?;
        Response::ok(UpsertProjectResponse {
            project: project.into(),
            ..Default::default()
        })
    }

    async fn delete_project(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteProjectRequest>,
    ) -> ServiceResult<DeleteProjectResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        let spec = crud::EntitySpec {
            table: Table::Project,
            kind: EntityKind::Project,
            name: "project",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteProjectResponse::default())
    }

    async fn upsert_account(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertAccountRequest>,
    ) -> ServiceResult<UpsertAccountResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        let account = request
            .to_owned_message()
            .account
            .into_option()
            .unwrap_or_default();
        let account = do_upsert_account(&self.pool, &self.hub, &current.email, account).await?;
        Response::ok(UpsertAccountResponse {
            account: account.into(),
            ..Default::default()
        })
    }

    async fn delete_account(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteAccountRequest>,
    ) -> ServiceResult<DeleteAccountResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        do_delete_account(&self.pool, &self.hub, &current.email, request.id).await?;
        Response::ok(DeleteAccountResponse::default())
    }
}

fn validate_project(project: &Project) -> AppResult<()> {
    if project.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "project.name must not be empty".to_string(),
        ));
    }
    Ok(())
}

/// Set `project.accounts` on every project from the `account` table,
/// grouped by `project_id` (one query for the whole list, then in-memory
/// grouping — never a per-project round trip).
async fn attach_accounts(pool: &SqlitePool, projects: &mut [Project]) -> AppResult<()> {
    let accounts = list_all_accounts(pool).await?;
    let mut by_project: std::collections::HashMap<String, Vec<Account>> =
        std::collections::HashMap::new();
    for account in accounts {
        by_project
            .entry(account.project_id.clone())
            .or_default()
            .push(account);
    }
    for project in projects {
        project.accounts = by_project.remove(&project.id).unwrap_or_default();
    }
    Ok(())
}

/// Raw column tuple of an `account` row, as read back by
/// [`list_all_accounts`] and [`fetch_accounts`] — one tuple type so the two
/// identical query shapes stay under clippy's `type_complexity` lint.
type AccountRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Fetch the persisted accounts of one project, ordered by `rowid` (their
/// insertion order).
async fn accounts_for_project(pool: &SqlitePool, project_id: &str) -> AppResult<Vec<Account>> {
    let mut conn = pool.acquire().await?;
    fetch_accounts(&mut conn, project_id).await
}

async fn list_all_accounts(pool: &SqlitePool) -> AppResult<Vec<Account>> {
    let mut conn = pool.acquire().await?;
    let rows: Vec<AccountRow> =
        sqlx::query_as(
            "SELECT id, project_id, name, status, start_date, end_date, budget FROM account ORDER BY rowid ASC",
        )
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, project_id, name, status, start_date, end_date, budget)| Account {
                id,
                project_id,
                name,
                status: account_status_from_db(&status),
                start_date,
                end_date,
                budget,
                ..Default::default()
            },
        )
        .collect())
}

async fn fetch_accounts(conn: &mut SqliteConnection, project_id: &str) -> AppResult<Vec<Account>> {
    let rows: Vec<AccountRow> =
        sqlx::query_as(
            "SELECT id, project_id, name, status, start_date, end_date, budget FROM account WHERE project_id = ?1 ORDER BY rowid ASC",
        )
        .bind(project_id)
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, project_id, name, status, start_date, end_date, budget)| Account {
                id,
                project_id,
                name,
                status: account_status_from_db(&status),
                start_date,
                end_date,
                budget,
                ..Default::default()
            },
        )
        .collect())
}

/// Assign a fresh id if `account.id` is empty (a create), validate, then
/// write the `account` row (checking the referenced project exists inside
/// the same transaction) and its `change_log` entry in one transaction,
/// publishing the resulting event only after that transaction commits.
/// Returns the account as persisted, so the caller can hand the
/// (possibly id-assigned) entity back in the RPC response.
async fn do_upsert_account(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    mut account: Account,
) -> AppResult<Account> {
    if account.id.is_empty() {
        account.id = uuid::Uuid::new_v4().to_string();
    }
    validate_account(&account)?;

    let mut tx = pool.begin().await?;
    let project_exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM project WHERE id = ?1")
        .bind(&account.project_id)
        .fetch_optional(&mut *tx)
        .await?;
    if project_exists.is_none() {
        return Err(AppError::NotFound("project", account.project_id.clone()));
    }

    sqlx::query(
        "INSERT INTO account (id, project_id, name, status, start_date, end_date, budget, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name, status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date, budget = excluded.budget",
    )
    .bind(&account.id)
    .bind(&account.project_id)
    .bind(&account.name)
    .bind(account_status_to_db(account.status))
    .bind(account.start_date.as_deref())
    .bind(account.end_date.as_deref())
    .bind(account.budget.as_deref())
    .bind(now_millis())
    .execute(&mut *tx)
    .await?;

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            EntityKind::Account,
            ChangeOp::Upsert,
            &account.id,
            None,
            Some(account.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(account)
}

/// Delete the `account` row for `id`, recording a `ChangeOp::Delete` event.
/// Assignment rows planning onto the account cascade away via the `account`
/// table's `ON DELETE CASCADE` (SQLite's `foreign_keys` pragma is on — see
/// `db::connect`). Returns `AppError::NotFound("account", id)` if no row
/// matched — nothing is written or published on that path.
async fn do_delete_account(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    id: &str,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let result = sqlx::query("DELETE FROM account WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("account", id.to_string()));
    }
    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            EntityKind::Account,
            ChangeOp::Delete,
            id,
            None,
            None,
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

fn validate_account(account: &Account) -> AppResult<()> {
    if account.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "account.name must not be empty".to_string(),
        ));
    }
    if account.project_id.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "account.project_id must not be empty".to_string(),
        ));
    }
    // Status must be a known non-unspecified variant (confirmed or
    // requested); the project-existence check needs the DB and happens in
    // `do_upsert_account`, inside the same transaction as the write.
    match account.status.as_known() {
        Some(AccountStatus::Unspecified) | None => {
            return Err(AppError::InvalidArgument(
                "account.status must not be unspecified".to_string(),
            ));
        }
        Some(_) => {}
    }
    if let Some(date) = account.start_date.as_deref()
        && !looks_like_iso_date(date)
    {
        return Err(AppError::InvalidArgument(format!(
            "account.start_date {date:?} is not a YYYY-MM-DD date"
        )));
    }
    if let Some(date) = account.end_date.as_deref()
        && !looks_like_iso_date(date)
    {
        return Err(AppError::InvalidArgument(format!(
            "account.end_date {date:?} is not a YYYY-MM-DD date"
        )));
    }
    if let (Some(start), Some(end)) = (account.start_date.as_deref(), account.end_date.as_deref())
        && start > end
    {
        return Err(AppError::InvalidArgument(
            "account.start_date must not be after account.end_date".to_string(),
        ));
    }
    if let Some(budget) = account.budget.as_deref()
        && budget.trim().is_empty()
    {
        return Err(AppError::InvalidArgument(
            "account.budget must not be empty".to_string(),
        ));
    }
    if let Some(budget) = account.budget.as_deref()
        && budget.len() > 64
    {
        return Err(AppError::InvalidArgument(
            "account.budget must be at most 64 characters".to_string(),
        ));
    }
    Ok(())
}

/// Render an [`EnumValue<AccountStatus>`] for storage in the
/// `account.status` TEXT column as its proto variant name (e.g.
/// `"ACCOUNT_STATUS_CONFIRMED"`) — callers only ever reach this after
/// [`validate_account`] has already rejected unknown/unspecified values,
/// but an unrecognized value still falls back to the unspecified variant's
/// name rather than panicking.
fn account_status_to_db(value: buffa::EnumValue<AccountStatus>) -> String {
    value
        .as_known()
        .unwrap_or(AccountStatus::Unspecified)
        .proto_name()
        .to_string()
}

/// The inverse of [`account_status_to_db`]. An unrecognized stored string
/// (hand-edited row, a variant retired in a later release) logs a warning
/// and falls back to `ACCOUNT_STATUS_UNSPECIFIED` rather than failing the
/// read — matching `absence_type_from_db`'s stance in `services::planning`.
fn account_status_from_db(value: &str) -> buffa::EnumValue<AccountStatus> {
    match AccountStatus::from_proto_name(value) {
        Some(known) => buffa::EnumValue::Known(known),
        None => {
            tracing::warn!(
                value,
                "unknown status in account table; defaulting to unspecified"
            );
            buffa::EnumValue::Known(AccountStatus::Unspecified)
        }
    }
}

/// `true` if `s` has the structural shape of `YYYY-MM-DD` (four digits, a
/// `-`, two digits, a `-`, two digits). This is a cheap syntactic check —
/// it does not reject e.g. `2024-02-30` — good enough to catch malformed
/// input without hand-rolling full calendar validation. Duplicated from
/// `services::planning` (private there; the codebase already duplicates
/// such helpers — see `seed.rs`).
fn looks_like_iso_date(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}
