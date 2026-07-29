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
