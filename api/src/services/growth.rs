//! `GrowthService`: 1:1 session records.
//!
//! Unlike every other master-data entity, `one_on_one` is not a plain
//! `id`/`updated_at`/`data` blob table (see `migrations/0001_init.sql`): it
//! carries an extra `employee_id TEXT NOT NULL` column (with its own index)
//! so lookups can filter by employee without decoding every row's blob.
//! That column must stay in sync with the encoded `OneOnOneSession.employee_id`
//! inside `data` on every write.
//!
//! Two ways to support that: (a) teach `store::Table` a variant carrying an
//! extra column, or (b) hand-write the three queries here. This module picks
//! (b) — `one_on_one` is the *only* table in the closed set with this shape,
//! so generalizing `store::Table`'s otherwise-uniform five-variant, three-
//! function API to carry an optional extra synced column would complicate
//! every other call site for a single one-off table. `services::crud`
//! likewise isn't reused here for the same reason: its `upsert`/`delete`
//! call `store::upsert_blob`/`delete_blob` directly, neither of which knows
//! about `employee_id`.

use buffa::Message;
use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::{SqlitePool, SqliteConnection};

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::{self, Hub, PendingEvents};
use crate::proto::events::{ChangeOp, EntityKind};
use crate::proto::growth::{
    DeleteSessionRequest, DeleteSessionResponse, GrowthService, ListSessionsRequest,
    ListSessionsResponse, OneOnOneSession, UpsertSessionRequest, UpsertSessionResponse,
};

pub struct GrowthServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl GrowthServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl GrowthService for GrowthServiceImpl {
    async fn list_sessions(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListSessionsRequest>,
    ) -> ServiceResult<ListSessionsResponse> {
        let sessions = list_all(&self.pool).await?;
        Response::ok(ListSessionsResponse {
            sessions,
            ..Default::default()
        })
    }

    async fn upsert_session(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertSessionRequest>,
    ) -> ServiceResult<UpsertSessionResponse> {
        let current = auth::require(&ctx)?;
        let session = request.to_owned_message().session.into_option().unwrap_or_default();
        let session = do_upsert(&self.pool, &self.hub, &current.email, session).await?;
        Response::ok(UpsertSessionResponse {
            session: session.into(),
            ..Default::default()
        })
    }

    async fn delete_session(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteSessionRequest>,
    ) -> ServiceResult<DeleteSessionResponse> {
        let current = auth::require(&ctx)?;
        do_delete(&self.pool, &self.hub, &current.email, request.id).await?;
        Response::ok(DeleteSessionResponse::default())
    }
}

fn validate_session(session: &OneOnOneSession) -> AppResult<()> {
    if session.employee_id.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "session.employee_id must not be empty".to_string(),
        ));
    }
    Ok(())
}

/// List every `one_on_one` row, decoded as `OneOnOneSession`, ordered by
/// `id` — matching `store::list_blobs`'s ordering guarantee for the other
/// blob tables.
async fn list_all(pool: &SqlitePool) -> AppResult<Vec<OneOnOneSession>> {
    let mut conn = pool.acquire().await?;
    let rows: Vec<Vec<u8>> = sqlx::query_scalar("SELECT data FROM one_on_one ORDER BY id")
        .fetch_all(&mut *conn)
        .await?;
    rows.into_iter()
        .map(|data| OneOnOneSession::decode_from_slice(&data).map_err(AppError::from))
        .collect()
}

/// Assign a fresh id if `session.id` is empty (a create), validate, then
/// write the `one_on_one` row (keeping its `employee_id` column in sync with
/// the encoded blob) and its `change_log` entry in one transaction,
/// publishing the resulting event only after that transaction commits.
/// Returns the session as persisted, so the caller can hand the
/// (possibly id-assigned) entity back in the RPC response.
async fn do_upsert(
    pool: &SqlitePool,
    hub: &Hub,
    actor_email: &str,
    mut session: OneOnOneSession,
) -> AppResult<OneOnOneSession> {
    if session.id.is_empty() {
        session.id = uuid::Uuid::new_v4().to_string();
    }
    validate_session(&session)?;

    let mut tx = pool.begin().await?;
    upsert_session_row(&mut tx, &session.id, &session.employee_id, &session).await?;
    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            EntityKind::OneOnOneSession,
            ChangeOp::Upsert,
            &session.id,
            None,
            Some(session.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(session)
}

/// Delete the `one_on_one` row for `id`, recording a `ChangeOp::Delete`
/// event. Returns `AppError::NotFound("one_on_one_session", id)` if no row
/// matched — nothing is written or published on that path.
async fn do_delete(pool: &SqlitePool, hub: &Hub, actor_email: &str, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    if !delete_session_row(&mut tx, id).await? {
        return Err(AppError::NotFound("one_on_one_session", id.to_string()));
    }
    let mut pending = PendingEvents::new();
    pending.push(events::record(&mut tx, actor_email, EntityKind::OneOnOneSession, ChangeOp::Delete, id, None, None).await?);
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}

/// Insert or replace the `one_on_one` row for `id`, keeping the
/// `employee_id` column (used by `idx_one_on_one_employee_id`) in sync with
/// the encoded `session` blob's own `employee_id` field.
async fn upsert_session_row(
    conn: &mut SqliteConnection,
    id: &str,
    employee_id: &str,
    session: &OneOnOneSession,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO one_on_one (id, employee_id, updated_at, data) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET employee_id = excluded.employee_id, updated_at = excluded.updated_at, data = excluded.data",
    )
    .bind(id)
    .bind(employee_id)
    .bind(now_millis())
    .bind(session.encode_to_vec())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Delete the `one_on_one` row for `id`. Returns `true` if a row was
/// deleted, `false` if `id` did not exist.
async fn delete_session_row(conn: &mut SqliteConnection, id: &str) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM one_on_one WHERE id = ?1")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
