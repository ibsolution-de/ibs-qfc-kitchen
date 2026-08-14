//! `PlanningService`: named, versioned planning scenarios (`plan_version`)
//! plus the high-churn rows that hang off one (`assignment`, `absence`,
//! `quarter_data`), and read-only `public_holiday` lookup.
//!
//! Unlike the plain blob-backed master-data entities (see `services::crud`),
//! every table here is typed columns, not an encoded-proto blob — the
//! planner queries and filters on `employee_id`/`project_id`/`date`
//! directly (see `migrations/0001_init.sql`'s design-intent comment).
//! `quarter_data` is the one exception with a blob column (`data`), since a
//! `QuarterData` snapshot has no columns the planner needs to filter on;
//! its `position` column exists purely for client-facing ordering, so it is
//! never surfaced in the proto message itself.
//!
//! Every mutating RPC follows the same write contract as the rest of the
//! service layer (see `events`'s module-level ordering invariant): all
//! writes for one call happen inside a single transaction alongside their
//! `change_log` row(s), and the resulting event(s) are only published to
//! [`Hub`] after that transaction commits.
//!
//! Following that convention, every RPC's fallible logic lives in a private
//! `do_*` (or plain, for read paths) async function returning [`AppResult`]
//! rather than directly in the trait method body: `AppError` has a `#[from]
//! sqlx::Error` impl, so `?` on a raw `sqlx` call converts automatically
//! inside those, whereas `ConnectError` (the trait methods' own error type)
//! does not implement `From<sqlx::Error>` and would need a `.map_err(...)`
//! `?` at every call site instead.
//!
//! Access control: every mutating RPC requires the caller to hold `pm` or
//! `bl` (`auth::require_any_role`); reads (`ListVersions`, `GetVersion`,
//! `ListHolidays`) are open to every authenticated user, matching the
//! read-only planner employees see in the web app.

use buffa::{EnumValue, Enumeration, Message};
use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::{SqliteConnection, SqlitePool};

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::{self, Hub, PendingEvents};
use crate::proto::events::{ChangeOp, EntityKind};
use crate::proto::planning::{
    Absence, AbsenceType, ApplyAbsencesRequest, ApplyAbsencesResponse, ApplyAssignmentsRequest,
    ApplyAssignmentsResponse, Assignment, CreateVersionRequest, CreateVersionResponse,
    DeleteQuarterDataRequest, DeleteQuarterDataResponse, DeleteVersionRequest,
    DeleteVersionResponse, GetVersionRequest, GetVersionResponse, ListHolidaysRequest,
    ListHolidaysResponse, ListVersionsRequest, ListVersionsResponse, PlanVersion, PlanVersionMeta,
    PlanningService, PublicHoliday, QuarterData, UpdateVersionMetaRequest,
    UpdateVersionMetaResponse, UpsertQuarterDataRequest, UpsertQuarterDataResponse,
};
use crate::proto::session::UserRole;
use crate::time::now_millis;

/// The owner (as stored in `plan_version.owner`) of the deployment
/// baseline and the automatic quarterly snapshots. Such versions are
/// read-only for every user (`require_mutable_by` refuses them before any
/// ownership check).
const SYSTEM_OWNER: &str = "system";

/// Actor identity used for automatic housekeeping writes (quarterly snapshot,
/// retention pruning) so they are not attributed to whichever user happened
/// to call `ListVersions` first.
const SYSTEM_ACTOR: &str = SYSTEM_OWNER;

/// The deployment baseline plan version inserted by migration 0005. It is
/// protected from retention pruning so a fresh/reset database always has at
/// least one revision.
const BASELINE_VERSION_ID: &str = "v1";

pub struct PlanningServiceImpl {
    pool: SqlitePool,
    hub: Hub,
    /// How many plan revisions (frozen planning snapshots) the system
    /// keeps: the startup fallback for the runtime-editable
    /// `settings.plan_revision_retention` meta override (see
    /// `reconcile_plan_revisions`). Older revisions are pruned once a new
    /// one is created.
    env_plan_revision_retention: i64,
}

impl PlanningServiceImpl {
    /// Default retention for `new` (no env value): 5 revisions, matching
    /// `config::DEFAULT_PLAN_REVISION_RETENTION` — kept in one place so any
    /// drift between the two defaults is immediately visible.
    const DEFAULT_ENV_RETENTION: i64 = 5;

    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self::new_with_retention(pool, hub, Self::DEFAULT_ENV_RETENTION)
    }

    pub fn new_with_retention(
        pool: SqlitePool,
        hub: Hub,
        env_plan_revision_retention: i64,
    ) -> Self {
        Self {
            pool,
            hub,
            env_plan_revision_retention,
        }
    }
}

impl PlanningService for PlanningServiceImpl {
    async fn list_versions(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListVersionsRequest>,
    ) -> ServiceResult<ListVersionsResponse> {
        let _current = auth::require(&ctx)?;
        // Best-effort housekeeping on a read path: a rollover into a new
        // quarter should auto-freeze a snapshot, and over-retention
        // revisions should be pruned, but neither must ever take the
        // whole app down with a load error — the same work is retried by
        // the next request (see `reconcile_plan_revisions`).
        if let Err(e) = reconcile_plan_revisions(
            &self.pool,
            &self.hub,
            SYSTEM_ACTOR,
            self.env_plan_revision_retention,
        )
        .await
        {
            tracing::warn!(error = %e, "reconcile_plan_revisions failed");
        }
        let versions = list_version_metas(&self.pool).await?;
        Response::ok(ListVersionsResponse {
            versions,
            ..Default::default()
        })
    }

    async fn get_version(
        &self,
        _ctx: RequestContext,
        request: ServiceRequest<'_, GetVersionRequest>,
    ) -> ServiceResult<GetVersionResponse> {
        let version = fetch_version(&self.pool, request.version_id).await?;
        Response::ok(GetVersionResponse {
            version: version.into(),
            ..Default::default()
        })
    }

    async fn create_version(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, CreateVersionRequest>,
    ) -> ServiceResult<CreateVersionResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        // Note: the quarterly auto-snapshot and retention pruning run on
        // `ListVersions` only — every SPA session starts with one, so both
        // fire without additional calls, and keeping them off the mutation
        // path guarantees a manual create interacts with exactly the
        // versions it sees.
        let version = do_create_version(
            &self.pool,
            &self.hub,
            &current.email,
            request.to_owned_message(),
        )
        .await?;
        Response::ok(CreateVersionResponse {
            version: version.into(),
            ..Default::default()
        })
    }

    async fn update_version_meta(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpdateVersionMetaRequest>,
    ) -> ServiceResult<UpdateVersionMetaResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let meta =
            do_update_version_meta(&self.pool, &self.hub, &current, request.to_owned_message())
                .await?;
        Response::ok(UpdateVersionMetaResponse {
            meta: meta.into(),
            ..Default::default()
        })
    }

    async fn delete_version(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteVersionRequest>,
    ) -> ServiceResult<DeleteVersionResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let version_id = request.version_id.to_string();
        do_delete_version(&self.pool, &self.hub, &current, &version_id).await?;
        Response::ok(DeleteVersionResponse::default())
    }

    async fn apply_assignments(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ApplyAssignmentsRequest>,
    ) -> ServiceResult<ApplyAssignmentsResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let seq = do_apply_assignments(&self.pool, &self.hub, &current, request.to_owned_message())
            .await?;
        Response::ok(ApplyAssignmentsResponse {
            seq,
            ..Default::default()
        })
    }

    async fn apply_absences(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ApplyAbsencesRequest>,
    ) -> ServiceResult<ApplyAbsencesResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let seq =
            do_apply_absences(&self.pool, &self.hub, &current, request.to_owned_message()).await?;
        Response::ok(ApplyAbsencesResponse {
            seq,
            ..Default::default()
        })
    }

    async fn upsert_quarter_data(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertQuarterDataRequest>,
    ) -> ServiceResult<UpsertQuarterDataResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let quarter =
            do_upsert_quarter_data(&self.pool, &self.hub, &current, request.to_owned_message())
                .await?;
        Response::ok(UpsertQuarterDataResponse {
            quarter: quarter.into(),
            ..Default::default()
        })
    }

    async fn delete_quarter_data(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteQuarterDataRequest>,
    ) -> ServiceResult<DeleteQuarterDataResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl])?;
        let version_id = request.version_id.to_string();
        let id = request.id.to_string();
        do_delete_quarter_data(&self.pool, &self.hub, &current, &version_id, &id).await?;
        Response::ok(DeleteQuarterDataResponse::default())
    }

    async fn list_holidays(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListHolidaysRequest>,
    ) -> ServiceResult<ListHolidaysResponse> {
        let holidays = list_all_holidays(&self.pool).await?;
        Response::ok(ListHolidaysResponse {
            holidays,
            ..Default::default()
        })
    }
}

/// List every `plan_version` row as `PlanVersionMeta`, ordered by
/// `created_at` ascending (the web app treats the last entry as the
/// editable version — this ordering is load-bearing; epoch-millis INTEGER
/// sorts chronologically just like the ISO text it replaced). `rowid`
/// (SQLite's implicit row id, distinct from the `id` column) breaks ties
/// between versions created within the same millisecond, so two versions
/// created back to back always sort in creation order rather than however
/// SQLite happens to return equal keys.
async fn list_version_metas(pool: &SqlitePool) -> AppResult<Vec<PlanVersionMeta>> {
    let rows: Vec<(String, String, Option<String>, i64, String, String)> = sqlx::query_as(
        "SELECT v.id, v.name, v.description, v.created_at, v.owner, COALESCE(u.name, v.owner)
         FROM plan_version v
         LEFT JOIN users u ON u.email = v.owner
         ORDER BY v.created_at ASC, v.rowid ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, description, created_at_millis, owner, owner_name)| {
                let owner_name = if owner == SYSTEM_OWNER {
                    "System".to_string()
                } else {
                    owner_name
                };
                PlanVersionMeta {
                    id,
                    name,
                    description,
                    created_at_millis,
                    owner,
                    owner_name,
                    ..Default::default()
                }
            },
        )
        .collect())
}

/// Plan-revision housekeeping, run best-effort on `ListVersions`:
/// automatically freezes a snapshot at each quarter rollover, then prunes
/// the history down to the configured retention. Errors are dropped (the
/// caller logs nothing further) rather than taken down with the read path —
/// the next request re-runs whatever failed, and the `ensure` half is
/// guarded by its own always-visible invariant ("a revision named after
/// the current quarter exists"), so a partial failure can never wedge a
/// subsequent run.
///
/// Both halves are deliberately triggered on a *read* RPC: the SPA calls
/// `ListVersions` on every load, which is what lets the automatic
/// quarter-snapshot fire without a cron job, and keeps running servers
/// correct even when they never receive a mutating call. Manual
/// `CreateVersion` deliberately does NOT re-run it, so a manual create
/// interacts with exactly the revisions the caller saw.
async fn reconcile_plan_revisions(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    env_retention: i64,
) -> AppResult<()> {
    let retention = effective_retention(pool, env_retention).await?;
    ensure_quarterly_revision(pool, hub, actor_email).await?;
    prune_plan_revisions(pool, hub, actor_email, retention).await?;
    Ok(())
}

/// The effective plan-revision retention: the `settings.plan_revision_retention`
/// meta override when a valid one is stored, otherwise the startup
/// environment value. Invalid stores (hand-edited or future-version rows)
/// are logged by `settings` and fall back to the environment, mirroring
/// how the other `settings.*` keys resolve.
async fn effective_retention(pool: &SqlitePool, env_retention: i64) -> AppResult<i64> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM meta WHERE key = ?1")
        .bind(crate::settings::PLAN_REVISION_RETENTION_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(match row {
        Some((value,)) => crate::settings::retention_from_value(&value).unwrap_or(env_retention),
        None => env_retention,
    })
}

/// Guarantee the current quarter has a frozen plan revision **per owner**
/// (`plan_version.owner`): each owner's revision history gets its own
/// quarterly auto-snapshot, deep-copied from that owner's latest revision
/// and owned by the same owner.
///
/// When no `plan_version` named after the quarter containing "now"
/// (e.g. `Q3 2026`) exists for an owner, deep-copies that owner's latest
/// revision into a new one with that name. The per-owner name check and
/// copy run in one transaction, so two concurrent requests racing the
/// rollover cannot both create; the loser hits SQLite's single-writer lock
/// and surfaces an error which the caller's best-effort handling absorbs
/// (the winner's revision then satisfies the next run's name guard). A
/// database whose only revision is literally named like the current quarter
/// (e.g. the `2026` baseline) is treated as already snapshotted/covered and
/// skipped for that owner.
///
/// No-op (still commits read guards) when every owner already has the
/// quarter label or no revision exists to copy from.
async fn ensure_quarterly_revision(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
) -> AppResult<()> {
    let Some(current_quarter) = quarter_label(now_millis()) else {
        tracing::warn!("clock before 1970; skipping quarterly plan-revision snapshot");
        return Ok(());
    };

    let mut tx = pool.begin().await?;

    let owners: Vec<String> = sqlx::query_scalar("SELECT DISTINCT owner FROM plan_version")
        .fetch_all(&mut *tx)
        .await?;
    let mut pending = PendingEvents::new();
    for owner in owners {
        let named: Option<String> = sqlx::query_scalar(
            "SELECT id FROM plan_version WHERE owner = ?1 AND name = ?2 LIMIT 1",
        )
        .bind(&owner)
        .bind(&current_quarter)
        .fetch_optional(&mut *tx)
        .await?;
        if named.is_some() {
            continue;
        }

        let latest_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM plan_version WHERE owner = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .bind(&owner)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(latest_id) = latest_id else {
            continue;
        };

        let id = uuid::Uuid::new_v4().to_string();
        let created_at_millis = now_millis();
        sqlx::query(
            "INSERT INTO plan_version (id, name, description, created_at, updated_at, owner) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&id)
        .bind(&current_quarter)
        .bind("Automatic quarterly plan snapshot.")
        .bind(created_at_millis)
        .bind(now_millis())
        .bind(&owner)
        .execute(&mut *tx)
        .await?;

        copy_assignments(&mut tx, &latest_id, &id).await?;
        copy_absences(&mut tx, &latest_id, &id).await?;
        copy_quarter_data(&mut tx, &latest_id, &id).await?;

        let meta = PlanVersionMeta {
            id: id.clone(),
            name: current_quarter.clone(),
            description: Some("Automatic quarterly plan snapshot.".to_string()),
            created_at_millis,
            owner: owner.clone(),
            owner_name: if owner == SYSTEM_OWNER {
                "System".to_string()
            } else {
                owner.clone()
            },
            ..Default::default()
        };

        pending.push(
            events::record(
                &mut tx,
                actor_email,
                EntityKind::PlanVersion,
                ChangeOp::Upsert,
                &id,
                Some(&id),
                Some(meta.encode_to_vec()),
            )
            .await?,
        );
    }
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

/// Delete the oldest `plan_version` rows (with their cascade-deleted
/// assignments/absences/quarter_data) of **each owner** until only
/// `retention` remain **per owner**. Never deletes the latest revision of
/// an owner: pruning only ever removes from the front of that owner's
/// chronological list. Emits a `PLAN_VERSION` DELETE `change_log` row (and
/// watch event) per pruned revision so connected clients drop the frozen
/// view as it disappears. No-op when every owner's count is already within
/// the limit.
async fn prune_plan_revisions(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    retention: i64,
) -> AppResult<()> {
    if retention < 2 {
        // Defensive: retention is validated to 2/3/5/10 upstream, but a
        // misconfigured value must never allow deleting the last revision
        // (the SPA has no empty-version state).
        return Ok(());
    }
    let owners: Vec<String> = sqlx::query_scalar("SELECT owner FROM plan_version GROUP BY owner")
        .fetch_all(pool)
        .await?;

    let mut pending = PendingEvents::new();
    let mut tx = pool.begin().await?;
    for owner in owners {
        let ids: Vec<String> = sqlx::query_as::<_, (String,)>(
            "SELECT id FROM plan_version WHERE owner = ?1 ORDER BY created_at ASC, rowid ASC",
        )
        .bind(&owner)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        // The deployment baseline is protected from pruning; retention
        // counts that owner's user revisions only, so the baseline is kept
        // alongside up to `retention` newest user revisions.
        let user_ids: Vec<String> = ids
            .into_iter()
            .filter(|id| id != BASELINE_VERSION_ID)
            .collect();
        if user_ids.len() <= retention as usize {
            continue;
        }
        let victims = &user_ids[..user_ids.len() - retention as usize];

        for id in victims {
            sqlx::query("DELETE FROM plan_version WHERE id = ?1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            pending.push(
                events::record(
                    &mut tx,
                    actor_email,
                    EntityKind::PlanVersion,
                    ChangeOp::Delete,
                    id,
                    Some(id),
                    None,
                )
                .await?,
            );
        }
    }
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

/// The quarter label containing `millis`, e.g. `"Q3 2026"` — the name the
/// quarterly auto-snapshot gives its revisions, chosen so it parses back
/// via the SPA's `parseQuarterName` (`Q{n} {year}`) which the forecast
/// window currently matches. `None` for timestamps before the epoch (the
/// civil-from-days algorithm needs a non-negative day count).
fn quarter_label(millis: i64) -> Option<String> {
    if millis < 0 {
        return None;
    }
    // Civil date from epoch-millis, UTC ("civil_from_days", Howard Hinnant):
    // the ordering semantics the version timeline needs — no chrono crate
    // in this project, and the exact hour/day of the boundary does not
    // matter, only which quarter the timestamp falls into.
    let days = millis / 86_400_000;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 {
        yoe + era * 400 + 1
    } else {
        yoe + era * 400
    };
    let quarter = (month - 1) / 3 + 1;
    Some(format!("Q{quarter} {year}"))
}

/// Fetch the full `PlanVersion` (meta + assignments + absences + ordered
/// forecast data) for `version_id`, or `AppError::NotFound` if no
/// `plan_version` row matches.
async fn fetch_version(pool: &SqlitePool, version_id: &str) -> AppResult<PlanVersion> {
    let mut conn = pool.acquire().await?;
    let meta = fetch_version_meta(&mut conn, version_id).await?;

    let assignments = fetch_assignments(&mut conn, version_id).await?;
    let absences = fetch_absences(&mut conn, version_id).await?;
    let forecast_data = fetch_quarter_data(&mut conn, version_id).await?;

    Ok(PlanVersion {
        meta: meta.into(),
        assignments,
        absences,
        forecast_data,
        ..Default::default()
    })
}

/// Fetch one `plan_version` row as `PlanVersionMeta` (meta fields plus
/// `owner` and the display `owner_name`, resolved via `users` — "System"
/// for the system owner), or `AppError::NotFound` if no row matches.
async fn fetch_version_meta(
    conn: &mut SqliteConnection,
    version_id: &str,
) -> AppResult<PlanVersionMeta> {
    let row: Option<(String, Option<String>, i64, String, String)> = sqlx::query_as(
        "SELECT v.name, v.description, v.created_at, v.owner, COALESCE(u.name, v.owner)
         FROM plan_version v
         LEFT JOIN users u ON u.email = v.owner
         WHERE v.id = ?1",
    )
    .bind(version_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (name, description, created_at_millis, owner, owner_name) =
        row.ok_or_else(|| AppError::NotFound("plan_version", version_id.to_string()))?;
    let owner_name = if owner == SYSTEM_OWNER {
        "System".to_string()
    } else {
        owner_name
    };
    Ok(PlanVersionMeta {
        id: version_id.to_string(),
        name,
        description,
        created_at_millis,
        owner,
        owner_name,
        ..Default::default()
    })
}

/// Create a new plan version, deep-copying `request.copy_from_version_id`'s
/// assignments/absences/forecast data (with fresh ids) into it when set.
/// Returns the full persisted `PlanVersion`.
async fn do_create_version(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    request: CreateVersionRequest,
) -> AppResult<PlanVersion> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "name must not be empty".to_string(),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at_millis = now_millis();

    let mut tx = pool.begin().await?;

    if let Some(source_id) = request.copy_from_version_id.as_deref()
        && !version_exists(&mut tx, source_id).await?
    {
        return Err(AppError::NotFound("plan_version", source_id.to_string()));
        // Copying from any existing revision is allowed — frozen or foreign
        // snapshots are valid sources; only the source's existence is
        // required.
    }

    sqlx::query(
        "INSERT INTO plan_version (id, name, description, created_at, updated_at, owner) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&id)
    .bind(&request.name)
    .bind(request.description.as_deref())
    .bind(created_at_millis)
    .bind(now_millis())
    .bind(actor_email)
    .execute(&mut *tx)
    .await?;

    let (assignments, absences, forecast_data) = match request.copy_from_version_id.as_deref() {
        Some(source_id) => (
            copy_assignments(&mut tx, source_id, &id).await?,
            copy_absences(&mut tx, source_id, &id).await?,
            copy_quarter_data(&mut tx, source_id, &id).await?,
        ),
        None => (Vec::new(), Vec::new(), Vec::new()),
    };

    let meta = PlanVersionMeta {
        id: id.clone(),
        name: request.name,
        description: request.description,
        created_at_millis,
        owner: actor_email.to_string(),
        owner_name: actor_email.to_string(),
        ..Default::default()
    };

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            EntityKind::PlanVersion,
            ChangeOp::Upsert,
            &id,
            Some(&id),
            Some(meta.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);

    Ok(PlanVersion {
        meta: meta.into(),
        assignments,
        absences,
        forecast_data,
        ..Default::default()
    })
}

/// Rename/re-describe an existing plan version. Returns the updated meta,
/// or `AppError::NotFound` if `request.version_id` does not exist.
async fn do_update_version_meta(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    request: UpdateVersionMetaRequest,
) -> AppResult<PlanVersionMeta> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "name must not be empty".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, &request.version_id).await?;
    require_mutable_by(current, &owner)?;
    require_latest_owned_version(&mut tx, &request.version_id, &owner).await?;

    // The UPDATE only ever changes name/description; the owner and display
    // name are untouched columns, re-read via `fetch_version_meta` for the
    // response/event payload below.
    sqlx::query(
        "UPDATE plan_version SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
    )
    .bind(&request.name)
    .bind(request.description.as_deref())
    .bind(now_millis())
    .bind(&request.version_id)
    .execute(&mut *tx)
    .await?;

    let mut meta = fetch_version_meta(&mut tx, &request.version_id).await?;
    meta.name = request.name;
    meta.description = request.description;

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            &current.email,
            EntityKind::PlanVersion,
            ChangeOp::Upsert,
            &request.version_id,
            Some(&request.version_id),
            Some(meta.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);

    Ok(meta)
}

/// Delete a plan version, cascading (via `ON DELETE CASCADE`, which
/// requires SQLite's `foreign_keys` pragma to be on — see `db::connect`) to
/// its assignments/absences/quarter_data.
///
/// Unlike the other mutation paths, deletion is not restricted to the
/// owner's latest revision: an owner may delete any of their own revisions
/// (even a frozen intermediary one), mirroring the pre-ownership model
/// where delete was never frozen-restricted. Only the owner (or a `bl`
/// managing their plans) may delete, and system-owned revisions are
/// read-only for everyone.
async fn do_delete_version(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    version_id: &str,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, version_id).await?;
    require_mutable_by(current, &owner)?;
    // The SPA has no empty state for "zero plan versions" — refuse to
    // delete the last one rather than let a client paint that state. The
    // guard is global (not per owner): a fresh/reset database must always
    // retain at least its baseline revision.
    let total_versions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plan_version")
        .fetch_one(&mut *tx)
        .await?;
    if total_versions <= 1 {
        return Err(AppError::FailedPrecondition(
            "cannot delete the last remaining plan version".to_string(),
        ));
    }

    sqlx::query("DELETE FROM plan_version WHERE id = ?1")
        .bind(version_id)
        .execute(&mut *tx)
        .await?;

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            &current.email,
            EntityKind::PlanVersion,
            ChangeOp::Delete,
            version_id,
            Some(version_id),
            None,
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

/// Apply a batch of assignment upserts/deletes in one transaction, emitting
/// one event per affected row. Returns the highest `change_log.seq` written
/// by this call, or the pre-existing max if the batch wrote nothing (an
/// empty batch, or every `delete_ids` entry was already gone).
async fn do_apply_assignments(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    request: ApplyAssignmentsRequest,
) -> AppResult<i64> {
    let version_id = request.version_id;

    // Validate the whole batch before touching the database at all: an
    // invalid request must write nothing, and failing fast here avoids
    // even opening a transaction for it.
    for upsert in &request.upserts {
        validate_assignment_upsert(&version_id, upsert)?;
    }

    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, &version_id).await?;
    require_mutable_by(current, &owner)?;
    require_latest_owned_version(&mut tx, &version_id, &owner).await?;
    // `change_log.seq` is `AUTOINCREMENT`, so every event this call writes
    // from here on is strictly greater than this starting point.
    let mut seq = current_max_seq(&mut tx).await?;

    let mut pending = PendingEvents::new();
    for upsert in request.upserts {
        // An assignment onto an account (Beauftragung) binds to one
        // project: the account must exist and belong to the assignment's
        // own project. Legacy planning (`account_id` unset) is unaffected.
        if let Some(account_id) = upsert.account_id.as_deref()
            && !account_id.is_empty()
        {
            let account_project: Option<String> =
                sqlx::query_scalar("SELECT project_id FROM account WHERE id = ?1")
                    .bind(account_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            let account_project = account_project
                .ok_or_else(|| AppError::NotFound("account", account_id.to_string()))?;
            if account_project != upsert.project_id {
                return Err(AppError::InvalidArgument(format!(
                    "assignment.account_id {account_id:?} does not belong to assignment.project_id {:?}",
                    upsert.project_id
                )));
            }
        }

        let id = resolve_assignment_id(
            &mut tx,
            &version_id,
            &upsert.employee_id,
            &upsert.date,
            upsert.account_id.as_deref(),
            &upsert.id,
        )
        .await?;

        sqlx::query(
            "INSERT INTO assignment (id, version_id, employee_id, project_id, account_id, date, allocation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET version_id = excluded.version_id, employee_id = excluded.employee_id, project_id = excluded.project_id, account_id = excluded.account_id, date = excluded.date, allocation = excluded.allocation",
        )
        .bind(&id)
        .bind(&version_id)
        .bind(&upsert.employee_id)
        .bind(&upsert.project_id)
        .bind(upsert.account_id.as_deref())
        .bind(&upsert.date)
        .bind(upsert.allocation)
        .execute(&mut *tx)
        .await?;

        let persisted = Assignment {
            id: id.clone(),
            version_id: version_id.clone(),
            employee_id: upsert.employee_id,
            project_id: upsert.project_id,
            account_id: upsert.account_id,
            date: upsert.date,
            allocation: upsert.allocation,
            ..Default::default()
        };
        let event = events::record(
            &mut tx,
            &current.email,
            EntityKind::Assignment,
            ChangeOp::Upsert,
            &id,
            Some(&version_id),
            Some(persisted.encode_to_vec()),
        )
        .await?;
        seq = event.seq;
        pending.push(event);
    }

    for delete_id in request.delete_ids {
        let result = sqlx::query("DELETE FROM assignment WHERE id = ?1 AND version_id = ?2")
            .bind(&delete_id)
            .bind(&version_id)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() > 0 {
            let event = events::record(
                &mut tx,
                &current.email,
                EntityKind::Assignment,
                ChangeOp::Delete,
                &delete_id,
                Some(&version_id),
                None,
            )
            .await?;
            seq = event.seq;
            pending.push(event);
        }
    }

    tx.commit().await?;
    hub.publish_all(pending);
    Ok(seq)
}

/// The `absence` analogue of [`do_apply_assignments`].
async fn do_apply_absences(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    request: ApplyAbsencesRequest,
) -> AppResult<i64> {
    let version_id = request.version_id;

    for upsert in &request.upserts {
        validate_absence_upsert(&version_id, upsert)?;
    }

    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, &version_id).await?;
    require_mutable_by(current, &owner)?;
    require_latest_owned_version(&mut tx, &version_id, &owner).await?;
    let mut seq = current_max_seq(&mut tx).await?;

    let mut pending = PendingEvents::new();
    for upsert in request.upserts {
        let id = resolve_absence_id(
            &mut tx,
            &version_id,
            &upsert.employee_id,
            &upsert.date,
            &upsert.id,
        )
        .await?;
        let absence_type_db = absence_type_to_db(upsert.absence_type);

        sqlx::query(
            "INSERT INTO absence (id, version_id, employee_id, date, absence_type, approved) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET version_id = excluded.version_id, employee_id = excluded.employee_id, date = excluded.date, absence_type = excluded.absence_type, approved = excluded.approved",
        )
        .bind(&id)
        .bind(&version_id)
        .bind(&upsert.employee_id)
        .bind(&upsert.date)
        .bind(&absence_type_db)
        .bind(upsert.approved)
        .execute(&mut *tx)
        .await?;

        let persisted = Absence {
            id: id.clone(),
            version_id: version_id.clone(),
            employee_id: upsert.employee_id,
            date: upsert.date,
            absence_type: upsert.absence_type,
            approved: upsert.approved,
            ..Default::default()
        };
        let event = events::record(
            &mut tx,
            &current.email,
            EntityKind::Absence,
            ChangeOp::Upsert,
            &id,
            Some(&version_id),
            Some(persisted.encode_to_vec()),
        )
        .await?;
        seq = event.seq;
        pending.push(event);
    }

    for delete_id in request.delete_ids {
        let result = sqlx::query("DELETE FROM absence WHERE id = ?1 AND version_id = ?2")
            .bind(&delete_id)
            .bind(&version_id)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() > 0 {
            let event = events::record(
                &mut tx,
                &current.email,
                EntityKind::Absence,
                ChangeOp::Delete,
                &delete_id,
                Some(&version_id),
                None,
            )
            .await?;
            seq = event.seq;
            pending.push(event);
        }
    }

    tx.commit().await?;
    hub.publish_all(pending);
    Ok(seq)
}

/// Upsert one `quarter_data` row: a new id is appended at `MAX(position) +
/// 1` within its version; an existing id keeps its current position (the
/// `ON CONFLICT` branch below only ever updates `data`).
async fn do_upsert_quarter_data(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    request: UpsertQuarterDataRequest,
) -> AppResult<QuarterData> {
    let version_id = request.version_id;
    let mut quarter = request.quarter.into_option().unwrap_or_default();
    // A server-assigned id is always an INSERT; a client-supplied one may
    // still collide with an existing row (the ON CONFLICT update path).
    let fresh_id = quarter.id.is_empty();
    if fresh_id {
        quarter.id = uuid::Uuid::new_v4().to_string();
    }

    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, &version_id).await?;
    require_mutable_by(current, &owner)?;
    require_latest_owned_version(&mut tx, &version_id, &owner).await?;

    // Only the INSERT path consumes `position` (the ON CONFLICT branch
    // below updates `data` alone), so the MAX(position)+1 aggregate runs
    // only when this upsert can actually insert: always for a
    // server-assigned id, and for a client-supplied id only if no row
    // carries it yet. In the update case the bound value is ignored by
    // SQLite, so a plain 0 stands in.
    let next_position: i64 =
        if fresh_id || !quarter_data_exists(&mut tx, &version_id, &quarter.id).await? {
            sqlx::query_scalar(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM quarter_data WHERE version_id = ?1",
            )
            .bind(&version_id)
            .fetch_one(&mut *tx)
            .await?
        } else {
            0
        };

    sqlx::query(
        "INSERT INTO quarter_data (id, version_id, position, data) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(version_id, id) DO UPDATE SET data = excluded.data",
    )
    .bind(&quarter.id)
    .bind(&version_id)
    .bind(next_position)
    .bind(quarter.encode_to_vec())
    .execute(&mut *tx)
    .await?;

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            &current.email,
            EntityKind::QuarterData,
            ChangeOp::Upsert,
            &quarter.id,
            Some(&version_id),
            Some(quarter.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);

    Ok(quarter)
}

/// Delete one `quarter_data` row, or `AppError::NotFound` if it doesn't
/// exist.
async fn do_delete_quarter_data(
    pool: &SqlitePool,
    hub: &Hub,
    current: &crate::auth::CurrentUser,
    version_id: &str,
    id: &str,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let owner = fetch_version_owner(&mut tx, version_id).await?;
    require_mutable_by(current, &owner)?;
    require_latest_owned_version(&mut tx, version_id, &owner).await?;
    let result = sqlx::query("DELETE FROM quarter_data WHERE version_id = ?1 AND id = ?2")
        .bind(version_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("quarter_data", id.to_string()));
    }

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            &current.email,
            EntityKind::QuarterData,
            ChangeOp::Delete,
            id,
            Some(version_id),
            None,
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

async fn fetch_assignments(
    conn: &mut SqliteConnection,
    version_id: &str,
) -> AppResult<Vec<Assignment>> {
    let rows: Vec<(String, String, String, Option<String>, String, f64)> = sqlx::query_as(
        "SELECT id, employee_id, project_id, account_id, date, allocation FROM assignment WHERE version_id = ?1 ORDER BY id",
    )
    .bind(version_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, employee_id, project_id, account_id, date, allocation)| Assignment {
                id,
                version_id: version_id.to_string(),
                employee_id,
                project_id,
                account_id,
                date,
                allocation,
                ..Default::default()
            },
        )
        .collect())
}

async fn fetch_absences(conn: &mut SqliteConnection, version_id: &str) -> AppResult<Vec<Absence>> {
    let rows: Vec<(String, String, String, String, bool)> = sqlx::query_as(
        "SELECT id, employee_id, date, absence_type, approved FROM absence WHERE version_id = ?1 ORDER BY id",
    )
    .bind(version_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, employee_id, date, absence_type, approved)| Absence {
            id,
            version_id: version_id.to_string(),
            employee_id,
            date,
            absence_type: absence_type_from_db(&absence_type),
            approved,
            ..Default::default()
        })
        .collect())
}

/// Fetch every `quarter_data` row for `version_id`, decoded as
/// `QuarterData`, ordered by `position` — the column that carries client
/// display order (the proto message itself has no such field).
async fn fetch_quarter_data(
    conn: &mut SqliteConnection,
    version_id: &str,
) -> AppResult<Vec<QuarterData>> {
    let rows: Vec<Vec<u8>> =
        sqlx::query_scalar("SELECT data FROM quarter_data WHERE version_id = ?1 ORDER BY position")
            .bind(version_id)
            .fetch_all(&mut *conn)
            .await?;
    rows.into_iter()
        .map(|data| QuarterData::decode_from_slice(&data).map_err(AppError::from))
        .collect()
}

/// Deep-copy every `assignment` row of `source_id` into `new_version_id`,
/// assigning each copy a fresh uuid — `assignment.id` is a globally unique
/// primary key, so source row ids are never reused across versions.
async fn copy_assignments(
    conn: &mut SqliteConnection,
    source_id: &str,
    new_version_id: &str,
) -> AppResult<Vec<Assignment>> {
    let rows: Vec<(String, String, Option<String>, String, f64)> = sqlx::query_as(
        "SELECT employee_id, project_id, account_id, date, allocation FROM assignment WHERE version_id = ?1 ORDER BY id",
    )
    .bind(source_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut copied = Vec::with_capacity(rows.len());
    for (employee_id, project_id, account_id, date, allocation) in rows {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO assignment (id, version_id, employee_id, project_id, account_id, date, allocation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&id)
        .bind(new_version_id)
        .bind(&employee_id)
        .bind(&project_id)
        .bind(account_id.as_deref())
        .bind(&date)
        .bind(allocation)
        .execute(&mut *conn)
        .await?;
        copied.push(Assignment {
            id,
            version_id: new_version_id.to_string(),
            employee_id,
            project_id,
            account_id,
            date,
            allocation,
            ..Default::default()
        });
    }
    Ok(copied)
}

/// Deep-copy every `absence` row of `source_id` into `new_version_id` with
/// fresh ids — see [`copy_assignments`].
async fn copy_absences(
    conn: &mut SqliteConnection,
    source_id: &str,
    new_version_id: &str,
) -> AppResult<Vec<Absence>> {
    let rows: Vec<(String, String, String, bool)> = sqlx::query_as(
        "SELECT employee_id, date, absence_type, approved FROM absence WHERE version_id = ?1 ORDER BY id",
    )
    .bind(source_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut copied = Vec::with_capacity(rows.len());
    for (employee_id, date, absence_type_db, approved) in rows {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO absence (id, version_id, employee_id, date, absence_type, approved) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&id)
        .bind(new_version_id)
        .bind(&employee_id)
        .bind(&date)
        .bind(&absence_type_db)
        .bind(approved)
        .execute(&mut *conn)
        .await?;
        copied.push(Absence {
            id,
            version_id: new_version_id.to_string(),
            employee_id,
            date,
            absence_type: absence_type_from_db(&absence_type_db),
            approved,
            ..Default::default()
        });
    }
    Ok(copied)
}

/// Deep-copy every `quarter_data` row of `source_id` into `new_version_id`
/// with fresh ids, preserving each row's `position` (positions are only
/// ever compared within one version, so reusing the source's own values is
/// safe) — see [`copy_assignments`]. The copy's id is re-embedded into the
/// re-encoded blob, keeping `QuarterData.id` in sync with the `id` column
/// the same way a fresh upsert would.
async fn copy_quarter_data(
    conn: &mut SqliteConnection,
    source_id: &str,
    new_version_id: &str,
) -> AppResult<Vec<QuarterData>> {
    let rows: Vec<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT position, data FROM quarter_data WHERE version_id = ?1 ORDER BY position",
    )
    .bind(source_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut copied = Vec::with_capacity(rows.len());
    for (position, data) in rows {
        let mut quarter = QuarterData::decode_from_slice(&data)?;
        quarter.id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO quarter_data (id, version_id, position, data) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&quarter.id)
        .bind(new_version_id)
        .bind(position)
        .bind(quarter.encode_to_vec())
        .execute(&mut *conn)
        .await?;
        copied.push(quarter);
    }
    Ok(copied)
}

/// `true` if a `plan_version` row exists for `id`.
async fn version_exists(conn: &mut SqliteConnection, id: &str) -> AppResult<bool> {
    let found: Option<i64> = sqlx::query_scalar("SELECT 1 FROM plan_version WHERE id = ?1")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(found.is_some())
}

/// Fetch the `plan_version.owner` for `id`, or `AppError::NotFound` if no
/// row matches. The per-owner mutation gates start from this: every
/// mutating path resolves the owning PM (or `"system"`) before applying
/// [`require_mutable_by`]/[`require_latest_owned_version`].
async fn fetch_version_owner(conn: &mut SqliteConnection, version_id: &str) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT owner FROM plan_version WHERE id = ?1")
        .bind(version_id)
        .fetch_optional(&mut *conn)
        .await?;
    row.map(|(o,)| o)
        .ok_or_else(|| AppError::NotFound("plan_version", version_id.to_string()))
}

/// Refuse a mutation the caller is not allowed to make on `owner`'s plan.
///
/// Callers already passed `require_any_role([Pm, Bl])`; this re-checks the
/// owner-specific half of the contract: system-owned revisions (baseline,
/// quarterly snapshots) are read-only for every user; a PM may only touch
/// their own revisions; a `bl` manages every non-system plan.
fn require_mutable_by(current: &crate::auth::CurrentUser, owner: &str) -> AppResult<()> {
    let is_bl = current.roles.contains(&UserRole::Bl);
    if owner == SYSTEM_OWNER {
        return Err(AppError::FailedPrecondition(
            "plan revision is frozen".to_string(),
        ));
    }
    if owner == current.email {
        return Ok(()); // owner (pm or bl)
    }
    if is_bl {
        return Ok(()); // bl manages all plans
    }
    Err(AppError::PermissionDenied(
        "caller is not the plan owner".to_string(),
    ))
}

/// Refuse to mutate any revision other than the caller's-owner's newest.
/// Within one owner's history the latest revision is the only editable one;
/// older revisions are frozen snapshots of that owner. When the owner has
/// no revisions the check succeeds (nothing is frozen).
async fn require_latest_owned_version(
    conn: &mut SqliteConnection,
    version_id: &str,
    owner: &str,
) -> AppResult<()> {
    let latest: Option<String> = sqlx::query_scalar(
        "SELECT id FROM plan_version WHERE owner = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .bind(owner)
    .fetch_optional(&mut *conn)
    .await?;
    match latest {
        Some(id) if id != version_id => Err(AppError::FailedPrecondition(
            "plan revision is frozen".to_string(),
        )),
        _ => Ok(()),
    }
}

/// `true` if a `quarter_data` row exists for `(version_id, id)` — the key
/// `do_upsert_quarter_data`'s `ON CONFLICT` clause targets, used there to
/// skip the MAX(position)+1 aggregate on the update path.
async fn quarter_data_exists(
    conn: &mut SqliteConnection,
    version_id: &str,
    id: &str,
) -> AppResult<bool> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM quarter_data WHERE version_id = ?1 AND id = ?2")
            .bind(version_id)
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(found.is_some())
}

/// The current maximum `change_log.seq`, or `0` if the log is empty.
async fn current_max_seq(conn: &mut SqliteConnection) -> AppResult<i64> {
    let seq: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM change_log")
        .fetch_one(&mut *conn)
        .await?;
    Ok(seq)
}

/// Resolve the `assignment.id` an `ApplyAssignments` upsert should write to.
///
/// The unique indexes on `(version_id, employee_id, account_id, date)` (for
/// account-planning rows) and `(version_id, employee_id, project_id, date)`
/// (for legacy NULL-account rows) mean one employee/account/date — or
/// employee/project/date without an account — combination is one cell: if a
/// row already exists for that exact combination, its id is authoritative
/// regardless of what id the client sent — writing to it (rather than the
/// client's id) updates that cell in place instead of colliding with the
/// unique index. Only when no row matches that combination does the
/// client-supplied id (or a freshly generated one, if empty) apply. `IS`
/// (rather than `=`) matches the NULL legacy account_id correctly.
async fn resolve_assignment_id(
    conn: &mut SqliteConnection,
    version_id: &str,
    employee_id: &str,
    date: &str,
    account_id: Option<&str>,
    requested_id: &str,
) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM assignment WHERE version_id = ?1 AND employee_id = ?2 AND date = ?4 AND account_id IS ?3",
    )
    .bind(version_id)
    .bind(employee_id)
    .bind(account_id)
    .bind(date)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(match existing {
        Some(id) => id,
        None if requested_id.is_empty() => uuid::Uuid::new_v4().to_string(),
        None => requested_id.to_string(),
    })
}

/// The `absence` analogue of [`resolve_assignment_id`], keyed by the unique
/// index on `(version_id, employee_id, date)`.
async fn resolve_absence_id(
    conn: &mut SqliteConnection,
    version_id: &str,
    employee_id: &str,
    date: &str,
    requested_id: &str,
) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM absence WHERE version_id = ?1 AND employee_id = ?2 AND date = ?3",
    )
    .bind(version_id)
    .bind(employee_id)
    .bind(date)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(match existing {
        Some(id) => id,
        None if requested_id.is_empty() => uuid::Uuid::new_v4().to_string(),
        None => requested_id.to_string(),
    })
}

/// Validate one `ApplyAssignments` upsert entry against the request-level
/// `version_id`. A non-empty `upsert.version_id` that disagrees with
/// `version_id` is rejected; an empty one is treated as inherited from the
/// request (the field is redundant once the request itself is scoped by
/// version, and most callers omit it per-row).
fn validate_assignment_upsert(version_id: &str, upsert: &Assignment) -> AppResult<()> {
    if !upsert.version_id.is_empty() && upsert.version_id != version_id {
        return Err(AppError::InvalidArgument(format!(
            "assignment.version_id {:?} does not match the request's version_id {version_id:?}",
            upsert.version_id
        )));
    }
    if upsert.employee_id.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "assignment.employee_id must not be empty".to_string(),
        ));
    }
    if upsert.project_id.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "assignment.project_id must not be empty".to_string(),
        ));
    }
    if !looks_like_iso_date(&upsert.date) {
        return Err(AppError::InvalidArgument(format!(
            "assignment.date {:?} is not a YYYY-MM-DD date",
            upsert.date
        )));
    }
    if !(upsert.allocation > 0.0 && upsert.allocation <= 1.0) {
        return Err(AppError::InvalidArgument(format!(
            "assignment.allocation {} must be within (0.0, 1.0]",
            upsert.allocation
        )));
    }
    Ok(())
}

/// The `absence` analogue of [`validate_assignment_upsert`].
fn validate_absence_upsert(version_id: &str, upsert: &Absence) -> AppResult<()> {
    if !upsert.version_id.is_empty() && upsert.version_id != version_id {
        return Err(AppError::InvalidArgument(format!(
            "absence.version_id {:?} does not match the request's version_id {version_id:?}",
            upsert.version_id
        )));
    }
    if upsert.employee_id.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "absence.employee_id must not be empty".to_string(),
        ));
    }
    if !looks_like_iso_date(&upsert.date) {
        return Err(AppError::InvalidArgument(format!(
            "absence.date {:?} is not a YYYY-MM-DD date",
            upsert.date
        )));
    }
    match upsert.absence_type.as_known() {
        Some(AbsenceType::Unspecified) | None => {
            return Err(AppError::InvalidArgument(
                "absence.absence_type must not be unspecified".to_string(),
            ));
        }
        Some(_) => {}
    }
    Ok(())
}

/// `true` if `s` has the structural shape of `YYYY-MM-DD` (four digits, a
/// `-`, two digits, a `-`, two digits). This is a cheap syntactic check —
/// it does not reject e.g. `2024-02-30` — good enough to catch malformed
/// input without hand-rolling full calendar validation.
fn looks_like_iso_date(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

/// Render an [`EnumValue<AbsenceType>`] for storage in `absence.absence_type
/// TEXT`, as its proto variant name (e.g. `"ABSENCE_TYPE_VACATION"`) —
/// callers only ever reach this after [`validate_absence_upsert`] has
/// already rejected unknown/unspecified values, but an unrecognized value
/// still falls back to the unspecified variant's name rather than panicking.
fn absence_type_to_db(value: EnumValue<AbsenceType>) -> String {
    value
        .as_known()
        .unwrap_or(AbsenceType::Unspecified)
        .proto_name()
        .to_string()
}

/// The inverse of [`absence_type_to_db`]. An unrecognized stored string
/// (hand-edited row, a variant retired in a later release) logs a warning
/// and falls back to `ABSENCE_TYPE_UNSPECIFIED` rather than failing the
/// read — matching `auth::roles_from_db`'s stance on unrecognized stored
/// values.
fn absence_type_from_db(value: &str) -> EnumValue<AbsenceType> {
    match AbsenceType::from_proto_name(value) {
        Some(known) => EnumValue::Known(known),
        None => {
            tracing::warn!(
                value,
                "unknown absence_type in absence table; defaulting to unspecified"
            );
            EnumValue::Known(AbsenceType::Unspecified)
        }
    }
}

async fn list_all_holidays(pool: &SqlitePool) -> AppResult<Vec<PublicHoliday>> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT date, name, location FROM public_holiday ORDER BY date ASC")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(date, name, location)| PublicHoliday {
            date,
            name,
            location,
            ..Default::default()
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_like_iso_date_accepts_and_rejects() {
        assert!(looks_like_iso_date("2026-07-29"));
        assert!(!looks_like_iso_date("2026-7-29"));
        assert!(!looks_like_iso_date("2026/07/29"));
        assert!(!looks_like_iso_date(""));
    }
}
