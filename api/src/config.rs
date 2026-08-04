//! Runtime configuration, read once at startup from the environment.
//!
//! `RUST_LOG` is not handled here — `tracing-subscriber`'s `EnvFilter`
//! reads it directly (see `main.rs`).

use std::env;
use std::net::SocketAddr;

use crate::proto::session::UserRole;

const DEFAULT_BIND: &str = "0.0.0.0:8080";
const DEFAULT_DB_PATH: &str = "./qfc.db";
const DEFAULT_ROLE: &str = "employee";

/// The local-dev identity assumed for requests missing auth headers, parsed
/// from `QFC_DEV_USER=email|Display Name`. Must be unset in production.
#[derive(Debug, Clone)]
pub struct DevUser {
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP server binds to (`QFC_BIND`, default `0.0.0.0:8080`).
    pub bind: SocketAddr,
    /// Path to the SQLite database file (`QFC_DB_PATH`, default `./qfc.db`;
    /// the container image sets this to `/data/qfc.db`).
    pub db_path: String,
    /// Dev-mode identity fallback (`QFC_DEV_USER`), `None` in production.
    pub dev_user: Option<DevUser>,
    /// Role assigned the first time a user is ever seen (`QFC_DEFAULT_ROLE`,
    /// default `employee`) — see `admin_emails` for the one exception. Later
    /// logins never overwrite the roles already stored in the `users` row.
    pub default_role: UserRole,
    /// Email addresses (lower-cased; matched case-insensitively) seeded with
    /// role `admin` instead of `default_role` on first sighting
    /// (`QFC_ADMIN_EMAILS`, comma-separated, optional; empty if unset).
    pub admin_emails: Vec<String>,
}

/// A malformed environment variable. Kept separate from [`AppError`](crate::error::AppError)
/// since it can only occur at startup, before there is a request to attach it to.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("QFC_BIND={value:?} is not a valid socket address: {source}")]
    InvalidBind {
        value: String,
        source: std::net::AddrParseError,
    },
    #[error(
        "QFC_DEV_USER={value:?} must be formatted as \"email|Display Name\" (a non-empty email, a pipe, and a non-empty name)"
    )]
    InvalidDevUser { value: String },
    #[error(
        "QFC_DEFAULT_ROLE={value:?} is not a valid default role (valid values: employee, pm, bl, sales — admin is deliberately not accepted as a default)"
    )]
    InvalidDefaultRole { value: String },
}

impl Config {
    /// Read configuration from the process environment, applying defaults
    /// for anything unset.
    pub fn from_env() -> Result<Self, ConfigError> {
        let bind_str = env::var("QFC_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
        let bind = bind_str
            .parse()
            .map_err(|source| ConfigError::InvalidBind {
                value: bind_str.clone(),
                source,
            })?;

        let db_path = env::var("QFC_DB_PATH").unwrap_or_else(|_| DEFAULT_DB_PATH.to_string());

        let dev_user = match env::var("QFC_DEV_USER") {
            Ok(raw) => Some(parse_dev_user(&raw)?),
            Err(_) => None,
        };

        let default_role_raw =
            env::var("QFC_DEFAULT_ROLE").unwrap_or_else(|_| DEFAULT_ROLE.to_string());
        let default_role = parse_default_role(&default_role_raw)?;

        let admin_emails = env::var("QFC_ADMIN_EMAILS")
            .map(|raw| parse_admin_emails(&raw))
            .unwrap_or_default();

        Ok(Self {
            bind,
            db_path,
            dev_user,
            default_role,
            admin_emails,
        })
    }
}

fn parse_dev_user(raw: &str) -> Result<DevUser, ConfigError> {
    let (email, name) = raw
        .split_once('|')
        .filter(|(email, name)| !email.trim().is_empty() && !name.trim().is_empty())
        .ok_or_else(|| ConfigError::InvalidDevUser {
            value: raw.to_string(),
        })?;
    Ok(DevUser {
        email: email.trim().to_string(),
        name: name.trim().to_string(),
    })
}

/// Parse `QFC_DEFAULT_ROLE` into the generated [`UserRole`] enum,
/// case-insensitively, accepting the same lower-case words the SPA/proto use
/// (`employee`, `pm`, `bl`, `sales`).
///
/// `admin` is deliberately not among them: this role is only ever seeded
/// for a user nobody has vetted yet, and a mistyped env var must not be
/// able to mass-grant admin to every new login. Admin is granted
/// explicitly instead — via `QFC_ADMIN_EMAILS` at startup, or later through
/// `AdminService::UpsertUser`.
///
/// The name parsing itself is `settings::role_from_name`, the same mapping
/// the `meta`-table override reads, so env and database can never drift
/// apart on what a role name means.
fn parse_default_role(raw: &str) -> Result<UserRole, ConfigError> {
    match crate::settings::role_from_name(raw) {
        Some(role) if role != UserRole::Admin => Ok(role),
        _ => Err(ConfigError::InvalidDefaultRole {
            value: raw.to_string(),
        }),
    }
}

/// Parse `QFC_ADMIN_EMAILS` into a lower-cased list — a thin wrapper over
/// `settings::parse_email_list`, the same parser the `meta`-table override
/// uses, so both sources always mean exactly the same thing.
fn parse_admin_emails(raw: &str) -> Vec<String> {
    crate::settings::parse_email_list(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_dev_user() {
        let dev = parse_dev_user("a@b.com|Kulyk, Nazar").unwrap();
        assert_eq!(dev.email, "a@b.com");
        assert_eq!(dev.name, "Kulyk, Nazar");
    }

    #[test]
    fn rejects_dev_user_without_pipe() {
        assert!(parse_dev_user("a@b.com").is_err());
    }

    #[test]
    fn rejects_dev_user_with_empty_email() {
        assert!(parse_dev_user("|Name").is_err());
    }

    #[test]
    fn rejects_dev_user_with_empty_name() {
        assert!(parse_dev_user("a@b.com|").is_err());
    }

    #[test]
    fn parses_default_role_case_insensitively() {
        assert_eq!(parse_default_role("pm").unwrap(), UserRole::Pm);
        assert_eq!(parse_default_role("PM").unwrap(), UserRole::Pm);
        assert_eq!(parse_default_role(" Bl ").unwrap(), UserRole::Bl);
        assert_eq!(parse_default_role("employee").unwrap(), UserRole::Employee);
        assert_eq!(parse_default_role("SALES").unwrap(), UserRole::Sales);
    }

    #[test]
    fn rejects_unknown_default_role() {
        assert!(parse_default_role("admin").is_err());
    }

    #[test]
    fn default_role_constant_resolves_to_employee_not_pm() {
        assert_eq!(
            parse_default_role(DEFAULT_ROLE).unwrap(),
            UserRole::Employee
        );
    }

    #[test]
    fn parses_admin_emails_trims_and_lowercases() {
        let emails = parse_admin_emails(" A@B.com, c@d.com ,, e@f.com");
        assert_eq!(emails, vec!["a@b.com", "c@d.com", "e@f.com"]);
    }

    #[test]
    fn parses_admin_emails_empty_string_yields_empty_list() {
        assert!(parse_admin_emails("").is_empty());
    }
}
