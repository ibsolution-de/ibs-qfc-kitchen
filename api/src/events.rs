//! The change log + live-broadcast hub: the write path every business
//! service builds on.
//!
//! # Ordering invariant (do not violate)
//!
//! A `change_log` row is written **inside** the same DB transaction as the
//! entity write it describes (`store::upsert_blob` / `delete_blob` +
//! [`record`], both taking the same `&mut SqliteConnection`/`Transaction`).
//! The corresponding [`ChangeEvent`] is broadcast to live watchers **only
//! after** that transaction commits — never before, and never for a
//! transaction that rolls back.
//!
//! [`record`] enforces the "commit before publish" half of this by handing
//! the event back to the caller instead of publishing it directly; the
//! caller collects events from one or more `record` calls into a
//! [`PendingEvents`], and only calls [`Hub::publish_all`] once
//! `tx.commit().await?` has returned `Ok`:
//!
//! ```rust,ignore
//! let mut tx = pool.begin().await?;
//! store::upsert_blob(&mut tx, store::Table::Employee, &id, &employee).await?;
//! let mut pending = events::PendingEvents::new();
//! pending.push(
//!     events::record(
//!         &mut tx,
//!         &user.email,
//!         EntityKind::Employee,
//!         ChangeOp::Upsert,
//!         &id,
//!         None,
//!         Some(employee.encode_to_vec()),
//!     )
//!     .await?,
//! );
//! tx.commit().await?;
//! hub.publish_all(pending);
//! ```
//!
//! There is no path from a `PendingEvents` back into the broadcast channel
//! other than `publish_all`; a rolled-back transaction (an early `?` return
//! before `commit`) simply drops it, so nothing is ever broadcast for it.

use buffa::{Enumeration, Message};
use connectrpc::{ConnectError, ErrorCode};
use sqlx::{SqlitePool, SqliteConnection};
use tokio::sync::broadcast;

use crate::error::{AppError, AppResult};
use crate::proto::events::__buffa::oneof::change_event::Body;
use crate::proto::events::{ChangeEvent, ChangeOp, EntityKind};
use crate::proto::{crm, growth, planning, portfolio, strategy, team};

/// Roughly how many of the most recent `change_log` rows to retain (see
/// [`prune`]). Sized as "comfortably more than a client reconnecting after
/// a lunch break would need," not tuned against real traffic — revisit once
/// there's usage data to tune it against.
const RETENTION_ROWS: i64 = 20_000;

/// How often the background task re-runs [`prune`] after its initial,
/// at-startup pass.
const PRUNE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// Capacity of the live broadcast channel.
///
/// This is *not* the durable history window — that's `change_log`, bounded
/// by `RETENTION_ROWS` — it's how many not-yet-delivered events a lagging
/// subscriber may fall behind by before `tokio::sync::broadcast` starts
/// overwriting its oldest buffered entries (surfaced to that receiver as
/// `RecvError::Lagged`, which `services::events` turns into the
/// reload-required signal below). `broadcast::Sender::send` never blocks
/// regardless of this number, so a slow client degrades to "reconnect and
/// replay from `change_log`" rather than stalling the writer. 4096 is
/// generous for a burst of concurrent writes from a handful of internal
/// users.
const BROADCAST_CAPACITY: usize = 4096;

/// The live-event broadcast hub. Cheap to clone (an `Arc`-backed sender
/// underneath); one instance is shared across the whole process via
/// `AppState`.
#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<ChangeEvent>,
}

impl Hub {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        Self { tx }
    }

    /// Subscribe to the live event stream.
    ///
    /// Callers implementing replay-then-live semantics (see
    /// `services::events::EventServiceImpl::watch`) must subscribe
    /// **before** reading replay rows out of `change_log`, so no event
    /// committed in the gap between the replay query and this call is
    /// missed — any overlap between replay and live delivery is a client
    /// concern to dedupe by `seq`, not a server concern to avoid.
    pub fn subscribe(&self) -> broadcast::Receiver<ChangeEvent> {
        self.tx.subscribe()
    }

    /// Publish every event collected in `pending`, in order.
    ///
    /// Call this only after the transaction that produced them has
    /// committed — see the module-level ordering invariant.
    pub fn publish_all(&self, pending: PendingEvents) {
        for event in pending.events {
            // `send` only errors when there are currently zero receivers;
            // that's an ordinary state (nobody's watching right now), not a
            // failure worth propagating.
            let _ = self.tx.send(event);
        }
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

/// Collects [`ChangeEvent`]s produced by [`record`] calls inside an
/// in-flight transaction, so they can be handed to [`Hub::publish_all`]
/// together once that transaction has committed. See the module-level
/// ordering invariant for why this indirection exists.
#[derive(Default)]
pub struct PendingEvents {
    events: Vec<ChangeEvent>,
}

impl PendingEvents {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, event: ChangeEvent) {
        self.events.push(event);
    }
}

/// Insert one `change_log` row inside the caller's transaction and return
/// the fully-built [`ChangeEvent`] for it (with `seq` assigned by SQLite and
/// `body` decoded from `kind` + `payload`), for the caller to collect into a
/// [`PendingEvents`].
///
/// `payload` is the **encoded entity** bytes (e.g. `employee.encode_to_vec()`),
/// not an encoded `ChangeEvent` — the `kind` column tells readers which
/// proto type to decode it as. Pass `None` for `ChangeOp::Delete`, where
/// `kind` + `entity_id` alone identify what to drop.
pub async fn record(
    conn: &mut SqliteConnection,
    actor_email: &str,
    kind: EntityKind,
    op: ChangeOp,
    entity_id: &str,
    version_id: Option<&str>,
    payload: Option<Vec<u8>>,
) -> AppResult<ChangeEvent> {
    let ts_millis = now_millis();
    let seq: i64 = sqlx::query_scalar(
        "INSERT INTO change_log (kind, op, entity_id, version_id, actor_email, ts_millis, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         RETURNING seq",
    )
    .bind(kind.to_i32())
    .bind(op.to_i32())
    .bind(entity_id)
    .bind(version_id)
    .bind(actor_email)
    .bind(ts_millis)
    .bind(payload.as_deref())
    .fetch_one(&mut *conn)
    .await?;

    build_change_event(RawChangeLogRow {
        seq,
        kind,
        op,
        entity_id,
        version_id,
        actor_email,
        ts_millis,
        payload: payload.as_deref(),
    })
}

/// The oldest `seq` still present in `change_log`, or `None` if the table is
/// empty (either nothing has ever been recorded, or — impossible in
/// practice since [`prune`] always keeps the newest `RETENTION_ROWS` — the
/// log has been fully pruned).
pub(crate) async fn oldest_retained_seq(pool: &SqlitePool) -> AppResult<Option<i64>> {
    let oldest: Option<i64> = sqlx::query_scalar("SELECT MIN(seq) FROM change_log")
        .fetch_one(pool)
        .await?;
    Ok(oldest)
}

/// Replay every `change_log` row with `seq > since_seq`, in `seq` order.
///
/// Callers are responsible for first checking [`oldest_retained_seq`]
/// against `since_seq` and returning [`reload_required_error`] if the
/// requested history has been pruned — this function does not itself
/// detect that condition, it just reads whatever remains.
pub(crate) async fn replay_since(pool: &SqlitePool, since_seq: i64) -> AppResult<Vec<ChangeEvent>> {
    let rows: Vec<DbChangeLogRow> = sqlx::query_as(
        "SELECT seq, kind, op, entity_id, version_id, actor_email, ts_millis, payload
         FROM change_log WHERE seq > ?1 ORDER BY seq",
    )
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(seq, kind, op, entity_id, version_id, actor_email, ts_millis, payload)| {
            build_change_event(RawChangeLogRow {
                seq,
                kind: kind_from_db(kind)?,
                op: op_from_db(op)?,
                entity_id: &entity_id,
                version_id: version_id.as_deref(),
                actor_email: &actor_email,
                ts_millis,
                payload: payload.as_deref(),
            })
        })
        .collect()
}

/// Raw column tuple shape of a `change_log` row, as read back by
/// [`replay_since`]. A type alias purely to keep clippy's
/// `type_complexity` lint quiet at the call site above.
type DbChangeLogRow = (i64, i32, i32, String, Option<String>, String, i64, Option<Vec<u8>>);

/// The distinguishable error a `Watch` client must branch on: the change
/// history it needs (either because its `since_seq` predates the retention
/// floor, or because it lagged the live broadcast channel) is gone. The
/// client cannot resume incrementally and must do a full reload of current
/// state, then reconnect `Watch` with `since_seq` set to the seq it just
/// observed at reload time.
///
/// `ErrorCode::DataLoss` is the signal a caller branches on; the message is
/// for humans only.
pub fn reload_required_error() -> ConnectError {
    ConnectError::new(
        ErrorCode::DataLoss,
        "requested change history is no longer available; reload full state and reconnect",
    )
}

/// The fields of one `change_log` row, borrowed, in the shape [`record`]
/// and [`replay_since`] both need to build a [`ChangeEvent`] from — grouped
/// into a struct so `build_change_event` takes one argument instead of
/// eight.
struct RawChangeLogRow<'a> {
    seq: i64,
    kind: EntityKind,
    op: ChangeOp,
    entity_id: &'a str,
    version_id: Option<&'a str>,
    actor_email: &'a str,
    ts_millis: i64,
    payload: Option<&'a [u8]>,
}

fn build_change_event(row: RawChangeLogRow<'_>) -> AppResult<ChangeEvent> {
    Ok(ChangeEvent {
        seq: row.seq,
        kind: row.kind.into(),
        op: row.op.into(),
        entity_id: row.entity_id.to_string(),
        version_id: row.version_id.map(str::to_string),
        actor_email: row.actor_email.to_string(),
        ts_millis: row.ts_millis,
        body: decode_body(row.kind, row.payload)?,
        ..Default::default()
    })
}

/// Decode `payload` (the encoded entity, present on upserts, absent on
/// deletes) into the `ChangeEvent.body` oneof variant `kind` selects.
fn decode_body(kind: EntityKind, payload: Option<&[u8]>) -> AppResult<Option<Body>> {
    let Some(bytes) = payload else {
        return Ok(None);
    };
    let body = match kind {
        EntityKind::Employee => Body::from(team::Employee::decode_from_slice(bytes)?),
        EntityKind::Customer => Body::from(crm::Customer::decode_from_slice(bytes)?),
        EntityKind::Project => Body::from(portfolio::Project::decode_from_slice(bytes)?),
        EntityKind::PlanVersion => Body::from(planning::PlanVersionMeta::decode_from_slice(bytes)?),
        EntityKind::Assignment => Body::from(planning::Assignment::decode_from_slice(bytes)?),
        EntityKind::Absence => Body::from(planning::Absence::decode_from_slice(bytes)?),
        EntityKind::QuarterData => Body::from(planning::QuarterData::decode_from_slice(bytes)?),
        EntityKind::StrategicGoal => Body::from(strategy::StrategicGoal::decode_from_slice(bytes)?),
        EntityKind::NorthStarMetric => Body::from(strategy::NorthStarMetric::decode_from_slice(bytes)?),
        EntityKind::OneOnOneSession => Body::from(growth::OneOnOneSession::decode_from_slice(bytes)?),
        EntityKind::Unspecified => {
            return Err(AppError::Internal(
                "change_log row carries a payload but ENTITY_KIND_UNSPECIFIED".to_string(),
            ));
        }
    };
    Ok(Some(body))
}

fn kind_from_db(value: i32) -> AppResult<EntityKind> {
    EntityKind::from_i32(value)
        .ok_or_else(|| AppError::Internal(format!("change_log: unknown EntityKind {value}")))
}

fn op_from_db(value: i32) -> AppResult<ChangeOp> {
    ChangeOp::from_i32(value)
        .ok_or_else(|| AppError::Internal(format!("change_log: unknown ChangeOp {value}")))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Delete `change_log` rows beyond the most recent [`RETENTION_ROWS`]. Safe
/// to call concurrently with writers: it only ever removes rows older than
/// whatever the newest `RETENTION_ROWS` happen to be at the moment it runs,
/// and a fresh write can only add to that newest set, never shrink it.
pub async fn prune(pool: &SqlitePool) -> AppResult<u64> {
    let result = sqlx::query(
        "DELETE FROM change_log WHERE seq <= (SELECT MAX(seq) FROM change_log) - ?1",
    )
    .bind(RETENTION_ROWS)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Spawn a background task that prunes `change_log` once immediately
/// (covering the "run at startup" half of the retention policy) and then
/// every [`PRUNE_INTERVAL`] thereafter, for the life of the process.
pub fn spawn_pruning_task(pool: SqlitePool) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = prune(&pool).await {
                tracing::error!(error = %err, "change_log prune failed");
            }
            tokio::time::sleep(PRUNE_INTERVAL).await;
        }
    });
}
