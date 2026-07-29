//! Generated ConnectRPC/buffa types and service traits for the `qfc.*`
//! proto packages defined in `../proto/qfc/**/*.proto`.
//!
//! `include_generated!` pulls in the module tree emitted by `build.rs`
//! (see `Cargo.toml`'s `connectrpc-build` build-dependency), rooted at the
//! `qfc` package prefix shared by every `.proto` file. The `pub use` aliases
//! below give downstream code a shorter path per package, e.g.
//! `crate::proto::team::Employee` in addition to the full
//! `crate::proto::qfc::team::v1::Employee`.
//!
//! Nothing implements the services yet, so these re-exports are otherwise
//! flagged as unused; they are the intended public surface for downstream
//! code, so the lint is allowed narrowly here rather than removing them.
#![allow(unused_imports)]

connectrpc::include_generated!();

pub use qfc::admin::v1 as admin;
pub use qfc::crm::v1 as crm;
pub use qfc::events::v1 as events;
pub use qfc::growth::v1 as growth;
pub use qfc::planning::v1 as planning;
pub use qfc::portfolio::v1 as portfolio;
pub use qfc::session::v1 as session;
pub use qfc::strategy::v1 as strategy;
pub use qfc::team::v1 as team;
