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
//! at every call site instead. `do_delete_version` is the one exception,
//! returning `Result<(), ConnectError>` directly, since refusing to delete
//! the last remaining version needs `ErrorCode::FailedPrecondition` — a
//! code `AppError` has no variant for (adding one is `error.rs`, out of
//! this module's scope).

use buffa::{EnumValue, Enumeration, Message};
use connectrpc::{ConnectError, ErrorCode, RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::{SqliteConnection, SqlitePool};

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::{self, Hub, PendingEvents};
use crate::proto::events::{ChangeOp, EntityKind};
use crate::proto::planning::{
    AbsenceType, Absence, ApplyAbsencesRequest, ApplyAbsencesResponse, ApplyAssignmentsRequest,
    ApplyAssignmentsResponse, Assignment, CreateVersionRequest, CreateVersionResponse,
    DeleteQuarterDataRequest, DeleteQuarterDataResponse, DeleteVersionRequest,
    DeleteVersionResponse, GetVersionRequest, GetVersionResponse, ListHolidaysRequest,
    ListHolidaysResponse, ListVersionsRequest, ListVersionsResponse, PlanVersion, PlanVersionMeta,
    PlanningService, PublicHoliday, QuarterData, UpdateVersionMetaRequest,
    UpdateVersionMetaResponse, UpsertQuarterDataRequest, UpsertQuarterDataResponse,
};

pub struct PlanningServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl PlanningServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl PlanningService for PlanningServiceImpl {
    async fn list_versions(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListVersionsRequest>,
    ) -> ServiceResult<ListVersionsResponse> {
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
        let current = auth::require(&ctx)?;
        let version = do_create_version(&self.pool, &self.hub, &current.email, request.to_owned_message()).await?;
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
        let current = auth::require(&ctx)?;
        let meta = do_update_version_meta(&self.pool, &self.hub, &current.email, request.to_owned_message()).await?;
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
        let current = auth::require(&ctx)?;
        let version_id = request.version_id.to_string();
        do_delete_version(&self.pool, &self.hub, &current.email, &version_id).await?;
        Response::ok(DeleteVersionResponse::default())
    }

    async fn apply_assignments(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ApplyAssignmentsRequest>,
    ) -> ServiceResult<ApplyAssignmentsResponse> {
        let current = auth::require(&ctx)?;
        let seq = do_apply_assignments(&self.pool, &self.hub, &current.email, request.to_owned_message()).await?;
        Response::ok(ApplyAssignmentsResponse { seq, ..Default::default() })
    }

    async fn apply_absences(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ApplyAbsencesRequest>,
    ) -> ServiceResult<ApplyAbsencesResponse> {
        let current = auth::require(&ctx)?;
        let seq = do_apply_absences(&self.pool, &self.hub, &current.email, request.to_owned_message()).await?;
        Response::ok(ApplyAbsencesResponse { seq, ..Default::default() })
    }

    async fn upsert_quarter_data(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertQuarterDataRequest>,
    ) -> ServiceResult<UpsertQuarterDataResponse> {
        let current = auth::require(&ctx)?;
        let quarter = do_upsert_quarter_data(&self.pool, &self.hub, &current.email, request.to_owned_message()).await?;
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
        let current = auth::require(&ctx)?;
        let version_id = request.version_id.to_string();
        let id = request.id.to_string();
        do_delete_quarter_data(&self.pool, &self.hub, &current.email, &version_id, &id).await?;
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
/// editable version — this ordering is load-bearing). `rowid` (SQLite's
/// implicit row id, distinct from the `id` column) breaks ties between
/// versions created within the same second, so two versions created back
/// to back always sort in creation order rather than however SQLite
/// happens to return equal keys.
async fn list_version_metas(pool: &SqlitePool) -> AppResult<Vec<PlanVersionMeta>> {
    let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, description, created_at FROM plan_version ORDER BY created_at ASC, rowid ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, description, created_at)| PlanVersionMeta {
            id,
            name,
            description,
            created_at,
            ..Default::default()
        })
        .collect())
}

/// Fetch the full `PlanVersion` (meta + assignments + absences + ordered
/// forecast data) for `version_id`, or `AppError::NotFound` if no
/// `plan_version` row matches.
async fn fetch_version(pool: &SqlitePool, version_id: &str) -> AppResult<PlanVersion> {
    let mut conn = pool.acquire().await?;
    let meta_row: Option<(String, Option<String>, String)> =
        sqlx::query_as("SELECT name, description, created_at FROM plan_version WHERE id = ?1")
            .bind(version_id)
            .fetch_optional(&mut *conn)
            .await?;
    let (name, description, created_at) =
        meta_row.ok_or_else(|| AppError::NotFound("plan_version", version_id.to_string()))?;
    let meta = PlanVersionMeta {
        id: version_id.to_string(),
        name,
        description,
        created_at,
        ..Default::default()
    };

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

/// Create a new plan version, deep-copying `request.copy_from_version_id`'s
/// assignments/absences/forecast data (with fresh ids) into it when set.
/// Returns the full persisted `PlanVersion`.
async fn do_create_version(pool: &SqlitePool, hub: &Hub, actor_email: &str, request: CreateVersionRequest) -> AppResult<PlanVersion> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidArgument("name must not be empty".to_string()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = iso8601_now();

    let mut tx = pool.begin().await?;

    if let Some(source_id) = request.copy_from_version_id.as_deref()
        && !version_exists(&mut tx, source_id).await?
    {
        return Err(AppError::NotFound("plan_version", source_id.to_string()));
    }

    sqlx::query(
        "INSERT INTO plan_version (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&id)
    .bind(&request.name)
    .bind(request.description.as_deref())
    .bind(&created_at)
    .bind(now_millis())
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
        created_at,
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
    actor_email: &str,
    request: UpdateVersionMetaRequest,
) -> AppResult<PlanVersionMeta> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidArgument("name must not be empty".to_string()));
    }

    let mut tx = pool.begin().await?;
    // `RETURNING created_at` both applies the update and confirms whether a
    // row existed in one round trip: `None` means `id` didn't match
    // anything, so nothing was written.
    let created_at: Option<String> = sqlx::query_scalar(
        "UPDATE plan_version SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4 RETURNING created_at",
    )
    .bind(&request.name)
    .bind(request.description.as_deref())
    .bind(now_millis())
    .bind(&request.version_id)
    .fetch_optional(&mut *tx)
    .await?;
    let created_at = created_at.ok_or_else(|| AppError::NotFound("plan_version", request.version_id.clone()))?;

    let meta = PlanVersionMeta {
        id: request.version_id.clone(),
        name: request.name,
        description: request.description,
        created_at,
        ..Default::default()
    };

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
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
/// Returns `Result<(), ConnectError>` rather than `AppResult<()>` because
/// refusing to delete the last remaining version needs
/// `ErrorCode::FailedPrecondition`, a code `AppError` has no variant for
/// (see this module's top-level doc comment). Raw `sqlx` calls below
/// therefore need an explicit `.map_err(AppError::from)` before `?`, since
/// `ConnectError` (unlike `AppError`) has no `From<sqlx::Error>` impl;
/// calls already returning `AppResult` (`version_exists`, `events::record`)
/// convert with a plain `?`.
async fn do_delete_version(pool: &SqlitePool, hub: &Hub, actor_email: &str, version_id: &str) -> Result<(), ConnectError> {
    let mut tx = pool.begin().await.map_err(AppError::from)?;
    if !version_exists(&mut tx, version_id).await? {
        return Err(AppError::NotFound("plan_version", version_id.to_string()).into());
    }
    // The SPA has no empty state for "zero plan versions" — refuse to
    // delete the last one rather than let a client paint that state.
    let total_versions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plan_version")
        .fetch_one(&mut *tx)
        .await
        .map_err(AppError::from)?;
    if total_versions <= 1 {
        return Err(ConnectError::new(
            ErrorCode::FailedPrecondition,
            "cannot delete the last remaining plan version",
        ));
    }

    sqlx::query("DELETE FROM plan_version WHERE id = ?1")
        .bind(version_id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from)?;

    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            EntityKind::PlanVersion,
            ChangeOp::Delete,
            version_id,
            Some(version_id),
            None,
        )
        .await?,
    );
    tx.commit().await.map_err(AppError::from)?;
    hub.publish_all(pending);
    Ok(())
}

/// Apply a batch of assignment upserts/deletes in one transaction, emitting
/// one event per affected row. Returns the highest `change_log.seq` written
/// by this call, or the pre-existing max if the batch wrote nothing (an
/// empty batch, or every `delete_ids` entry was already gone).
async fn do_apply_assignments(pool: &SqlitePool, hub: &Hub, actor_email: &str, request: ApplyAssignmentsRequest) -> AppResult<i64> {
    let version_id = request.version_id;

    // Validate the whole batch before touching the database at all: an
    // invalid request must write nothing, and failing fast here avoids
    // even opening a transaction for it.
    for upsert in &request.upserts {
        validate_assignment_upsert(&version_id, upsert)?;
    }

    let mut tx = pool.begin().await?;
    if !version_exists(&mut tx, &version_id).await? {
        return Err(AppError::NotFound("plan_version", version_id));
    }
    // `change_log.seq` is `AUTOINCREMENT`, so every event this call writes
    // from here on is strictly greater than this starting point.
    let mut seq = current_max_seq(&mut tx).await?;

    let mut pending = PendingEvents::new();
    for upsert in request.upserts {
        let id = resolve_assignment_id(
            &mut tx,
            &version_id,
            &upsert.employee_id,
            &upsert.project_id,
            &upsert.date,
            &upsert.id,
        )
        .await?;

        sqlx::query(
            "INSERT INTO assignment (id, version_id, employee_id, project_id, date, allocation) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET version_id = excluded.version_id, employee_id = excluded.employee_id, project_id = excluded.project_id, date = excluded.date, allocation = excluded.allocation",
        )
        .bind(&id)
        .bind(&version_id)
        .bind(&upsert.employee_id)
        .bind(&upsert.project_id)
        .bind(&upsert.date)
        .bind(upsert.allocation)
        .execute(&mut *tx)
        .await?;

        let persisted = Assignment {
            id: id.clone(),
            version_id: version_id.clone(),
            employee_id: upsert.employee_id,
            project_id: upsert.project_id,
            date: upsert.date,
            allocation: upsert.allocation,
            ..Default::default()
        };
        let event = events::record(
            &mut tx,
            actor_email,
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
                actor_email,
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
async fn do_apply_absences(pool: &SqlitePool, hub: &Hub, actor_email: &str, request: ApplyAbsencesRequest) -> AppResult<i64> {
    let version_id = request.version_id;

    for upsert in &request.upserts {
        validate_absence_upsert(&version_id, upsert)?;
    }

    let mut tx = pool.begin().await?;
    if !version_exists(&mut tx, &version_id).await? {
        return Err(AppError::NotFound("plan_version", version_id));
    }
    let mut seq = current_max_seq(&mut tx).await?;

    let mut pending = PendingEvents::new();
    for upsert in request.upserts {
        let id = resolve_absence_id(&mut tx, &version_id, &upsert.employee_id, &upsert.date, &upsert.id).await?;
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
            actor_email,
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
                actor_email,
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
    actor_email: &str,
    request: UpsertQuarterDataRequest,
) -> AppResult<QuarterData> {
    let version_id = request.version_id;
    let mut quarter = request.quarter.into_option().unwrap_or_default();
    if quarter.id.is_empty() {
        quarter.id = uuid::Uuid::new_v4().to_string();
    }

    let mut tx = pool.begin().await?;
    if !version_exists(&mut tx, &version_id).await? {
        return Err(AppError::NotFound("plan_version", version_id));
    }

    let next_position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM quarter_data WHERE version_id = ?1")
        .bind(&version_id)
        .fetch_one(&mut *tx)
        .await?;

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
            actor_email,
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
async fn do_delete_quarter_data(pool: &SqlitePool, hub: &Hub, actor_email: &str, version_id: &str, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
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
            actor_email,
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

async fn fetch_assignments(conn: &mut SqliteConnection, version_id: &str) -> AppResult<Vec<Assignment>> {
    let rows: Vec<(String, String, String, String, f64)> = sqlx::query_as(
        "SELECT id, employee_id, project_id, date, allocation FROM assignment WHERE version_id = ?1 ORDER BY id",
    )
    .bind(version_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, employee_id, project_id, date, allocation)| Assignment {
            id,
            version_id: version_id.to_string(),
            employee_id,
            project_id,
            date,
            allocation,
            ..Default::default()
        })
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
async fn fetch_quarter_data(conn: &mut SqliteConnection, version_id: &str) -> AppResult<Vec<QuarterData>> {
    let rows: Vec<Vec<u8>> = sqlx::query_scalar("SELECT data FROM quarter_data WHERE version_id = ?1 ORDER BY position")
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
async fn copy_assignments(conn: &mut SqliteConnection, source_id: &str, new_version_id: &str) -> AppResult<Vec<Assignment>> {
    let rows: Vec<(String, String, String, f64)> = sqlx::query_as(
        "SELECT employee_id, project_id, date, allocation FROM assignment WHERE version_id = ?1 ORDER BY id",
    )
    .bind(source_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut copied = Vec::with_capacity(rows.len());
    for (employee_id, project_id, date, allocation) in rows {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO assignment (id, version_id, employee_id, project_id, date, allocation) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&id)
        .bind(new_version_id)
        .bind(&employee_id)
        .bind(&project_id)
        .bind(&date)
        .bind(allocation)
        .execute(&mut *conn)
        .await?;
        copied.push(Assignment {
            id,
            version_id: new_version_id.to_string(),
            employee_id,
            project_id,
            date,
            allocation,
            ..Default::default()
        });
    }
    Ok(copied)
}

/// Deep-copy every `absence` row of `source_id` into `new_version_id` with
/// fresh ids — see [`copy_assignments`].
async fn copy_absences(conn: &mut SqliteConnection, source_id: &str, new_version_id: &str) -> AppResult<Vec<Absence>> {
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
async fn copy_quarter_data(conn: &mut SqliteConnection, source_id: &str, new_version_id: &str) -> AppResult<Vec<QuarterData>> {
    let rows: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT position, data FROM quarter_data WHERE version_id = ?1 ORDER BY position")
            .bind(source_id)
            .fetch_all(&mut *conn)
            .await?;

    let mut copied = Vec::with_capacity(rows.len());
    for (position, data) in rows {
        let mut quarter = QuarterData::decode_from_slice(&data)?;
        quarter.id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO quarter_data (id, version_id, position, data) VALUES (?1, ?2, ?3, ?4)")
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

/// The current maximum `change_log.seq`, or `0` if the log is empty.
async fn current_max_seq(conn: &mut SqliteConnection) -> AppResult<i64> {
    let seq: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM change_log")
        .fetch_one(&mut *conn)
        .await?;
    Ok(seq)
}

/// Resolve the `assignment.id` an `ApplyAssignments` upsert should write to.
///
/// The unique index on `(version_id, employee_id, project_id, date)` means
/// one employee/project/date combination is one cell: if a row already
/// exists for that exact combination, its id is authoritative regardless of
/// what id the client sent — writing to it (rather than the client's id)
/// updates that cell in place instead of colliding with the unique index.
/// Only when no row matches that combination does the client-supplied id
/// (or a freshly generated one, if empty) apply.
async fn resolve_assignment_id(
    conn: &mut SqliteConnection,
    version_id: &str,
    employee_id: &str,
    project_id: &str,
    date: &str,
    requested_id: &str,
) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM assignment WHERE version_id = ?1 AND employee_id = ?2 AND project_id = ?3 AND date = ?4",
    )
    .bind(version_id)
    .bind(employee_id)
    .bind(project_id)
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
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM absence WHERE version_id = ?1 AND employee_id = ?2 AND date = ?3")
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
        return Err(AppError::InvalidArgument("assignment.employee_id must not be empty".to_string()));
    }
    if upsert.project_id.trim().is_empty() {
        return Err(AppError::InvalidArgument("assignment.project_id must not be empty".to_string()));
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
        return Err(AppError::InvalidArgument("absence.employee_id must not be empty".to_string()));
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
            tracing::warn!(value, "unknown absence_type in absence table; defaulting to unspecified");
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

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// The current UTC time as an ISO-8601 string (`YYYY-MM-DDTHH:MM:SSZ`),
/// matching the format already used by seeded plan-version data (see
/// `seed/seed.json`'s `createdAt` fields). No `chrono` dependency in this
/// crate — built directly from `SystemTime` plus [`civil_from_days`]'s
/// pure-integer calendar arithmetic.
fn iso8601_now() -> String {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = elapsed.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Howard Hinnant's `civil_from_days` algorithm: converts a day count since
/// the Unix epoch (1970-01-01) into a proleptic-Gregorian (year, month,
/// day) triple using only integer arithmetic — see
/// <http://howardhinnant.github.io/date_algorithms.html>.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_days_matches_known_epoch_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29), "2024 is a leap year");
        assert_eq!(civil_from_days(19_783), (2024, 3, 1));
    }

    #[test]
    fn iso8601_now_has_the_expected_shape() {
        let stamp = iso8601_now();
        assert_eq!(stamp.len(), 20, "{stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert!(looks_like_iso_date(&stamp[..10]), "{stamp}");
    }

    #[test]
    fn looks_like_iso_date_accepts_and_rejects() {
        assert!(looks_like_iso_date("2026-07-29"));
        assert!(!looks_like_iso_date("2026-7-29"));
        assert!(!looks_like_iso_date("2026/07/29"));
        assert!(!looks_like_iso_date(""));
    }
}
