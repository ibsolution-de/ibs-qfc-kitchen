//! SQLite pool setup and migrations.

use std::str::FromStr;
use std::time::Duration;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

use crate::error::{AppError, AppResult};

/// Connect to the SQLite database at `path`, creating the file if it does
/// not exist yet, and run any pending migrations.
pub async fn connect(path: &str) -> AppResult<SqlitePool> {
    let options = SqliteConnectOptions::from_str(path)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_millis(5000));

    let pool = SqlitePoolOptions::new()
        // This is a single-worker service writing to a single SQLite file:
        // SQLite serializes writers regardless of pool size, and WAL mode
        // lets readers proceed concurrently with the one in-flight writer.
        // A handful of connections is enough to keep read-only requests
        // (list/get RPCs) from queuing behind a slow writer without
        // pretending this is a pool sized for a multi-node service.
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|err| AppError::Internal(format!("migration failed: {err}")))?;

    Ok(pool)
}
