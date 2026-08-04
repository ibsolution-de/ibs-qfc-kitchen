//! Library crate root.
//!
//! `main.rs` is a thin binary that wires these modules together and starts
//! the server; splitting them out into a library target is what lets
//! `tests/*.rs` integration tests exercise the write path (`events`,
//! `store`) and service implementations directly, in-process, without going
//! through HTTP.

pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod events;
pub mod proto;
pub mod seed;
pub mod services;
pub mod store;

// Crate-private: runtime-editable settings persistence (`settings.*` keys
// in the `meta` table), an implementation detail of `auth` and
// `services::admin`, not part of the API the integration tests exercise.
pub(crate) mod settings;

/// Shared wall-clock helper (`now_millis`); public so `main.rs` can stamp
/// the server's start time for `AdminService::GetSystemStatus`.
pub mod time;
