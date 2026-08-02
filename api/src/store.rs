//! Blob-row helpers over the low-churn master-data tables (`employee`,
//! `customer`, `project`, `strategic_goal`, `north_star`): each is an
//! `id TEXT PRIMARY KEY, updated_at INTEGER, data BLOB` row, where `data` is
//! the encoded proto message (see `migrations/0001_init.sql`'s design-intent
//! comment).
//!
//! Every function here takes `&mut SqliteConnection` rather than a pool.
//! Callers write inside a transaction — the row change and its
//! `change_log` entry (see [`crate::events::record`]) must commit
//! atomically — and a `sqlx::Transaction` or `PoolConnection` both
//! deref-coerce to `&mut SqliteConnection`, so passing `&mut tx` just works.

use buffa::Message;
use sqlx::SqliteConnection;

use crate::error::{AppError, AppResult};
use crate::time::now_millis;

/// The closed set of blob-row tables. Table names are matched out of this
/// enum rather than accepted as a caller-supplied string, so no query below
/// ever interpolates untrusted input into SQL — only one of these five
/// fixed, hand-written literals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    Employee,
    Customer,
    Project,
    StrategicGoal,
    NorthStar,
}

impl Table {
    const fn name(self) -> &'static str {
        match self {
            Table::Employee => "employee",
            Table::Customer => "customer",
            Table::Project => "project",
            Table::StrategicGoal => "strategic_goal",
            Table::NorthStar => "north_star",
        }
    }
}

/// List every row in `table`, decoded as `M`, ordered by `id`.
pub async fn list_blobs<M: Message>(
    conn: &mut SqliteConnection,
    table: Table,
) -> AppResult<Vec<M>> {
    let sql = format!("SELECT data FROM {} ORDER BY id", table.name());
    // sqlx 0.9's `SqlSafeStr` bound forces every dynamic SQL string through
    // an explicit audit. This one is safe: `sql` is built purely from
    // `Table::name()`'s five hand-written literals, never from caller input.
    let rows: Vec<Vec<u8>> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await?;
    rows.into_iter()
        .map(|data| M::decode_from_slice(&data).map_err(AppError::from))
        .collect()
}

/// Insert or replace the row for `id` in `table` with `msg`'s encoded bytes,
/// stamping `updated_at` with the current time.
pub async fn upsert_blob<M: Message>(
    conn: &mut SqliteConnection,
    table: Table,
    id: &str,
    msg: &M,
) -> AppResult<()> {
    upsert_blob_bytes(conn, table, id, &msg.encode_to_vec()).await
}

/// [`upsert_blob`] with the message already encoded: callers that also need
/// the same bytes elsewhere (e.g. as the `change_log` payload for
/// [`crate::events::record`]) encode once and pass them here, instead of
/// paying a second `encode_to_vec()` for the identical byte string.
pub async fn upsert_blob_bytes(
    conn: &mut SqliteConnection,
    table: Table,
    id: &str,
    data: &[u8],
) -> AppResult<()> {
    let sql = format!(
        "INSERT INTO {table} (id, updated_at, data) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data",
        table = table.name(),
    );
    // See the comment in `list_blobs`: `sql` only ever embeds one of
    // `Table::name()`'s fixed literals, never caller-supplied text.
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .bind(now_millis())
        .bind(data)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Delete the row for `id` from `table`.
///
/// Returns `true` if a row was deleted, `false` if `id` did not exist —
/// callers that need a hard "not found" error map that themselves.
pub async fn delete_blob(conn: &mut SqliteConnection, table: Table, id: &str) -> AppResult<bool> {
    let sql = format!("DELETE FROM {} WHERE id = ?1", table.name());
    // See the comment in `list_blobs`: `sql` only ever embeds one of
    // `Table::name()`'s fixed literals, never caller-supplied text.
    let result = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(result.rows_affected() > 0)
}
