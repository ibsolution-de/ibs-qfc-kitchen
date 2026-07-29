//! Shared List/Upsert/Delete plumbing for the plain blob-backed master-data
//! entities (`team::Employee`, `crm::Customer`, `portfolio::Project`,
//! `strategy::StrategicGoal`, `strategy::NorthStarMetric`): every one of
//! them follows the exact same `(Table, EntityKind, message type)` shape and
//! the exact same write contract (see `crate::events`'s module-level
//! ordering invariant), so that boilerplate lives here once instead of five
//! times.
//!
//! `growth::OneOnOneSession` does **not** use this — its `one_on_one` table
//! carries an extra `employee_id` column outside the plain
//! `id`/`updated_at`/`data` shape these functions assume, so `growth.rs`
//! hand-writes its own three queries instead (see that module's comment for
//! why extending this helper, or `store::Table`, wasn't worth it for a
//! single one-off table).

use buffa::Message;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::events::{self, Hub, PendingEvents};
use crate::proto::events::{ChangeOp, EntityKind};
use crate::store::{self, Table};

/// The per-entity identity every plain blob-backed service supplies once:
/// which table/`change_log` kind it maps to, and the display name used in
/// a `NotFound` error. Grouping these three (rather than passing them as
/// separate parameters) is what keeps [`upsert`]/[`delete`] under clippy's
/// argument-count lint.
pub(crate) struct EntitySpec {
    pub table: Table,
    pub kind: EntityKind,
    /// Used only in the `NotFound(name, id)` error `delete` returns.
    pub name: &'static str,
}

/// List every row in `table`, decoded as `M` — see `store::list_blobs` for
/// the ordering guarantee.
pub(crate) async fn list<M: Message>(pool: &SqlitePool, table: Table) -> AppResult<Vec<M>> {
    let mut conn = pool.acquire().await?;
    store::list_blobs(&mut conn, table).await
}

/// Create-or-replace `entity` in `spec.table`: assigns a fresh UUID through
/// `access_id` if the entity's id is empty (a create), validates the
/// (possibly id-assigned) entity, then writes the row and its `change_log`
/// entry in one transaction and publishes the resulting event only after
/// that transaction commits.
///
/// `access_id` borrows the entity's `id: String` field mutably; called more
/// than once (to check-and-maybe-set, then to read), which is why it's
/// `Fn` rather than `FnOnce`.
///
/// Returns the entity as actually persisted (with a server-assigned id
/// merged in for a create) — the caller returns this in the RPC response,
/// since the client relies on it to learn a server-generated id.
pub(crate) async fn upsert<M: Message>(
    pool: &SqlitePool,
    hub: &Hub,
    spec: &EntitySpec,
    actor_email: &str,
    mut entity: M,
    access_id: impl Fn(&mut M) -> &mut String,
    validate: impl Fn(&M) -> AppResult<()>,
) -> AppResult<M> {
    if access_id(&mut entity).is_empty() {
        *access_id(&mut entity) = uuid::Uuid::new_v4().to_string();
    }
    validate(&entity)?;
    let id = access_id(&mut entity).clone();

    let mut tx = pool.begin().await?;
    store::upsert_blob(&mut tx, spec.table, &id, &entity).await?;
    let mut pending = PendingEvents::new();
    pending.push(
        events::record(
            &mut tx,
            actor_email,
            spec.kind,
            ChangeOp::Upsert,
            &id,
            None,
            Some(entity.encode_to_vec()),
        )
        .await?,
    );
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(entity)
}

/// Delete the row for `id` from `spec.table`, recording a `ChangeOp::Delete`
/// event. Returns `AppError::NotFound(spec.name, id)` if no row matched —
/// nothing is written or published on that path (the delete statement
/// itself is a no-op, and the transaction it ran in is simply dropped
/// un-committed).
pub(crate) async fn delete(pool: &SqlitePool, hub: &Hub, spec: &EntitySpec, actor_email: &str, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    if !store::delete_blob(&mut tx, spec.table, id).await? {
        return Err(AppError::NotFound(spec.name, id.to_string()));
    }
    let mut pending = PendingEvents::new();
    pending.push(events::record(&mut tx, actor_email, spec.kind, ChangeOp::Delete, id, None, None).await?);
    tx.commit().await?;
    hub.publish_all(pending);
    Ok(())
}
