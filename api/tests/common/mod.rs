//! Shared scaffolding for the `tests/*.rs` integration binaries: the
//! temp-SQLite-file plumbing every one of them used to carry as an
//! identical private copy of `temp_pool`/`cleanup`.
//!
//! Each test gets its own temp SQLite file (migrated fresh by
//! `qfc_api::db::connect`) and removes it again — including the `-wal`/`-shm`
//! sidecar files — on the way out. Removal is panic-safe: [`TempDb`] is a
//! drop guard, so a failing test still unlinks its files during unwinding
//! instead of leaking them into the shared temp dir. (`tempfile` would
//! give this for free, but it isn't in dev-dependencies; the guard below
//! is the twelve lines of `std::fs` that replace it.)

use std::path::PathBuf;

use qfc_api::db;
use sqlx::SqlitePool;

/// Handle to the temp database file backing a test's pool. `Drop` removes
/// the `db`/`-wal`/`-shm` files best-effort, so the panic path cleans up
/// too; [`TempDb::cleanup`] is the graceful version tests call explicitly,
/// closing the pool first so no connection outlives the deleted files.
pub struct TempDb {
    path: PathBuf,
}

impl TempDb {
    /// Close `pool`, then remove the database file and its WAL sidecars.
    /// Consumes `self`; the subsequent `Drop` simply retries the (already
    /// removed) paths, which `remove_file`'s ignored errors absorb.
    pub async fn cleanup(self, pool: SqlitePool) {
        pool.close().await;
        self.remove_files();
    }

    fn remove_files(&self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(format!("{}-wal", self.path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", self.path.display()));
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        // No async runtime here, so the pool can't be `close()`d first —
        // unlinking works regardless: the name is gone immediately and the
        // inode is reclaimed once SQLite's handles close.
        self.remove_files();
    }
}

/// A freshly migrated pool over a unique temp file, plus the [`TempDb`]
/// guard for it. `slug` goes into the file name (`qfc-<slug>-test-<uuid>.db`)
/// so leftover files from an interrupted run identify their test binary.
pub async fn temp_pool(slug: &str) -> (SqlitePool, TempDb) {
    let path = std::env::temp_dir().join(format!("qfc-{slug}-test-{}.db", uuid::Uuid::new_v4()));
    let pool = db::connect(path.to_str().expect("temp path is utf8"))
        .await
        .expect("connect to temp db");
    (pool, TempDb { path })
}
