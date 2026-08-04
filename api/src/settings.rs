//! Runtime-editable application settings, persisted as `settings.*` keys in
//! the `meta` key/value table, with the startup environment
//! (`QFC_DEFAULT_ROLE` / `QFC_ADMIN_EMAILS`) as the fallback for any key not
//! (validly) overridden there.
//!
//! # Precedence
//!
//! A `meta` row wins over the environment for its key: [`effective`] reports
//! the stored value (and flags it as overridden), falling back to the
//! startup environment per key — an invalid stored value (an unknown role
//! name, or `admin` as the default role) is warned about and treated as if
//! the row were absent, never as a hard error, so a hand-edited or
//! future-version row can never wedge the auth path.
//!
//! # First-seen-only effect
//!
//! These values are consulted exactly once per user: the first time the
//! auth middleware sees a login, when it seeds the new `users` row's roles
//! (see `auth::upsert_and_load`). Roles of already-known users are
//! admin-managed afterwards and are never re-derived from these settings —
//! changing the default role does not retroactively change anyone.

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::proto::session::UserRole;

/// `meta` key holding the default-role override: the lower-case role name
/// (`employee`/`pm`/`bl`/`sales`), as produced by [`role_to_name`].
pub(crate) const DEFAULT_ROLE_KEY: &str = "settings.default_role";

/// `meta` key holding the admin-emails override: lower-case addresses,
/// comma-separated, in the canonical form [`parse_email_list`] reads back.
pub(crate) const ADMIN_EMAILS_KEY: &str = "settings.admin_emails";

/// The lower-case name of a role, as used by the `settings.*` `meta` values
/// and by `QFC_DEFAULT_ROLE` — the inverse of [`role_from_name`].
///
/// `Unspecified` is never a storable setting (both [`update`] and
/// `config`'s env parsing reject it); guarded with a warning + a safe
/// fallback rather than `unreachable!()` so a future caller gets neither a
/// panic nor a silently empty string in the database.
pub(crate) fn role_to_name(role: UserRole) -> &'static str {
    match role {
        UserRole::Employee => "employee",
        UserRole::Pm => "pm",
        UserRole::Bl => "bl",
        UserRole::Sales => "sales",
        UserRole::Admin => "admin",
        UserRole::Unspecified => {
            tracing::warn!("role_to_name called with UserRole::Unspecified; using \"employee\"");
            "employee"
        }
    }
}

/// Parse a role name (case-insensitive, surrounding whitespace ignored)
/// back into the [`UserRole`] enum — the inverse of [`role_to_name`].
/// Returns `None` for anything unrecognized, including `unspecified`.
///
/// Unlike `config`'s `QFC_DEFAULT_ROLE` parsing this *does* accept `admin`;
/// whether admin is a legal value depends on the call site (it is not a
/// legal *default* role anywhere, and both `config` and [`update`] reject
/// it for that use).
pub(crate) fn role_from_name(raw: &str) -> Option<UserRole> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "employee" => Some(UserRole::Employee),
        "pm" => Some(UserRole::Pm),
        "bl" => Some(UserRole::Bl),
        "sales" => Some(UserRole::Sales),
        "admin" => Some(UserRole::Admin),
        _ => None,
    }
}

/// Parse a comma-separated email list into a lower-cased, trimmed list,
/// dropping empty entries (a trailing comma, for instance), so callers can
/// compare case-insensitively with a plain `==`. Shared by `config`
/// (`QFC_ADMIN_EMAILS`) and the `settings.admin_emails` `meta` value, so
/// both always mean exactly the same thing.
pub(crate) fn parse_email_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// Resolve the effective settings: the `meta` override for each key when a
/// valid one is stored, the startup environment otherwise. Returns the
/// resolved values plus, per key, whether the value came from the database
/// (`true` = DB override shadows the environment).
///
/// Invalid stored values — an unrecognized role name, or `admin` as the
/// default role (forbidden for the same reason `QFC_DEFAULT_ROLE` rejects
/// it: a mistake must not mass-grant admin to every new login) — are logged
/// and fall back to the environment for that key only.
pub(crate) async fn effective(
    pool: &SqlitePool,
    env_default: UserRole,
    env_admins: &[String],
) -> AppResult<(UserRole, Vec<String>, bool, bool)> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM meta WHERE key IN (?1, ?2)")
            .bind(DEFAULT_ROLE_KEY)
            .bind(ADMIN_EMAILS_KEY)
            .fetch_all(pool)
            .await?;

    let mut default_role = env_default;
    let mut default_role_overridden = false;
    let mut admin_emails = env_admins.to_vec();
    let mut admin_emails_overridden = false;

    for (key, value) in rows {
        match key.as_str() {
            DEFAULT_ROLE_KEY => match role_from_name(&value) {
                Some(role) if role != UserRole::Admin => {
                    default_role = role;
                    default_role_overridden = true;
                }
                _ => {
                    tracing::warn!(
                        value,
                        "meta: invalid {DEFAULT_ROLE_KEY} value; falling back to QFC_DEFAULT_ROLE"
                    );
                }
            },
            ADMIN_EMAILS_KEY => {
                // A stored list is always structurally parseable (worst case
                // it is empty, which is a legitimate "no seed admins"
                // override), so it always counts as overridden.
                admin_emails = parse_email_list(&value);
                admin_emails_overridden = true;
            }
            // The SELECT above restricts to the two known keys, so this is
            // unreachable; matched defensively rather than with
            // unreachable!() so a future third key degrades to "ignored"
            // instead of a panic on the auth hot path.
            other => {
                tracing::warn!(key = other, "meta: unexpected settings key; ignoring");
            }
        }
    }

    Ok((
        default_role,
        admin_emails,
        default_role_overridden,
        admin_emails_overridden,
    ))
}

/// Validate and persist both settings keys in a single transaction, so a
/// concurrent [`effective`] reader can never observe a half-applied pair.
///
/// Validation mirrors the startup-environment rules (`config`): the default
/// role must be a real, non-admin role (seeding admin by default would
/// grant it to every new login), and every admin email must look like an
/// email address. Emails are normalized to the canonical lower-case form
/// before storing, so [`effective`] reads back exactly what was written.
pub(crate) async fn update(
    pool: &SqlitePool,
    default_role: UserRole,
    admin_emails: &[String],
) -> AppResult<()> {
    if matches!(default_role, UserRole::Admin | UserRole::Unspecified) {
        return Err(AppError::InvalidArgument(
            "default_role must be one of employee, pm, bl, sales (admin is not allowed as a default)"
                .to_string(),
        ));
    }
    let normalized: Vec<String> = admin_emails
        .iter()
        .map(|email| email.trim().to_ascii_lowercase())
        .collect();
    for email in &normalized {
        if email.is_empty() || !email.contains('@') {
            return Err(AppError::InvalidArgument(format!(
                "admin email {email:?} must be non-empty and contain '@'"
            )));
        }
    }

    let mut tx = pool.begin().await?;
    for (key, value) in [
        (DEFAULT_ROLE_KEY, role_to_name(default_role).to_string()),
        (ADMIN_EMAILS_KEY, normalized.join(",")),
    ] {
        sqlx::query(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names_round_trip() {
        for role in [
            UserRole::Employee,
            UserRole::Pm,
            UserRole::Bl,
            UserRole::Sales,
            UserRole::Admin,
        ] {
            assert_eq!(role_from_name(role_to_name(role)), Some(role));
        }
    }

    #[test]
    fn role_from_name_is_case_insensitive_and_trims() {
        assert_eq!(role_from_name(" PM "), Some(UserRole::Pm));
        assert_eq!(role_from_name("EMPLOYEE"), Some(UserRole::Employee));
    }

    #[test]
    fn role_from_name_rejects_garbage_and_unspecified() {
        assert_eq!(role_from_name("bogus"), None);
        assert_eq!(role_from_name("unspecified"), None);
        assert_eq!(role_from_name(""), None);
    }

    #[test]
    fn parse_email_list_trims_lowercases_and_drops_empties() {
        let emails = parse_email_list(" A@B.com, c@d.com ,, e@f.com");
        assert_eq!(emails, vec!["a@b.com", "c@d.com", "e@f.com"]);
        assert!(parse_email_list("").is_empty());
    }
}
