//! Identifies the caller from proxy auth headers (or the `QFC_DEV_USER` dev
//! fallback), upserts the local `users` row, and hands services a
//! [`CurrentUser`] via [`require`].

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use connectrpc::{ConnectError, ErrorCode, RequestContext};
use sqlx::SqlitePool;

use crate::config::DevUser;
use crate::error::{AppError, AppResult};
use crate::proto::session::UserRole;
use crate::time::now_millis;

/// Header names set by the ingress auth proxy (oauth2-proxy and
/// compatible). `X-Auth-Request-Name` arrives surname-first (e.g.
/// `"Kulyk, Nazar"`) — stored verbatim, never reformatted.
const HEADER_EMAIL: &str = "x-auth-request-email";
const HEADER_NAME: &str = "x-auth-request-name";
const HEADER_PREFERRED_USERNAME: &str = "x-auth-request-preferred-username";
const HEADER_USER: &str = "x-auth-request-user";

/// Routes exempt from auth: the container's liveness/readiness probe must
/// work before the database (or an auth proxy) is reachable.
const EXEMPT_PATHS: &[&str] = &["/healthz"];

/// The authenticated caller for the current request, derived from proxy
/// headers (or `QFC_DEV_USER`) plus the stored `users` row.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub email: String,
    pub name: String,
    // Not yet surfaced by any service (the `User` proto message has no
    // subject field) — carried on `CurrentUser` for future handlers that
    // need the IdP-asserted identifier rather than the mutable email/name.
    #[allow(dead_code)]
    pub subject: Option<String>,
    /// A user holds a set of roles, never exactly one — never empty either:
    /// see [`roles_from_db`]'s fallback for what guarantees that.
    pub roles: Vec<UserRole>,
    pub employee_id: Option<String>,
}

/// State the auth middleware needs: the DB pool to upsert/load users
/// against, the optional dev-mode identity fallback, and the role-seeding
/// configuration (`QFC_DEFAULT_ROLE` / `QFC_ADMIN_EMAILS`) applied the first
/// time a user is ever seen.
#[derive(Clone)]
pub struct AuthState {
    pub pool: SqlitePool,
    pub dev_user: Option<DevUser>,
    pub default_role: UserRole,
    pub admin_emails: Vec<String>,
}

/// Fetch the current caller for a service handler.
///
/// One-liner for handlers: `let user = auth::require(&ctx)?;`. Only fails
/// if the auth middleware wasn't applied in front of this route, which is a
/// wiring bug rather than a real per-request condition.
pub fn require(ctx: &RequestContext) -> Result<CurrentUser, ConnectError> {
    ctx.extensions()
        .get::<CurrentUser>()
        .cloned()
        .ok_or_else(|| ConnectError::new(ErrorCode::Unauthenticated, "authentication required"))
}

/// Fetch the current caller for a handler that requires a specific role,
/// e.g. `let current = auth::require_role(&ctx, UserRole::Admin)?;`.
///
/// Only "must hold this one role" is needed today (every `AdminService`
/// handler), so this deliberately takes a single [`UserRole`] rather than a
/// role list — generalize only once a second caller actually needs it.
pub fn require_role(ctx: &RequestContext, role: UserRole) -> Result<CurrentUser, ConnectError> {
    let current = require(ctx)?;
    if current.roles.contains(&role) {
        Ok(current)
    } else {
        Err(AppError::PermissionDenied(format!("requires the {role:?} role")).into())
    }
}

/// Read a single request header as an owned, UTF-8 `String`, or `None` if
/// absent or not valid UTF-8.
fn header_value(req: &Request, name: &'static str) -> Option<String> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// Axum middleware: resolve [`CurrentUser`] and insert it into the
/// request's extensions for downstream handlers to read via [`require`].
pub async fn middleware(State(state): State<AuthState>, mut req: Request, next: Next) -> Response {
    if EXEMPT_PATHS.contains(&req.uri().path()) {
        return next.run(req).await;
    }

    // Header values must be materialized to owned `String`s before
    // `req.extensions_mut()` is touched below — holding `req.headers()`
    // borrowed across that call does not borrow-check. A free function
    // (rather than a closure bound to a local) also keeps each borrow of
    // `req` scoped to its own call, so it doesn't linger in the `async fn`'s
    // generated future state and trip the `Send` bound `from_fn_with_state`
    // requires.
    let header_email = header_value(&req, HEADER_EMAIL);
    let header_name = header_value(&req, HEADER_NAME);
    let header_preferred_username = header_value(&req, HEADER_PREFERRED_USERNAME);
    let header_user = header_value(&req, HEADER_USER);

    let (email, name, subject) = match header_email {
        Some(email) => {
            let name = header_name
                .or(header_preferred_username)
                .or_else(|| header_user.clone())
                .unwrap_or_else(|| email.clone());
            (email, name, header_user)
        }
        None => match &state.dev_user {
            Some(dev) => (dev.email.clone(), dev.name.clone(), None),
            // No proxy header and no dev fallback configured: reject before
            // touching the database.
            None => return StatusCode::UNAUTHORIZED.into_response(),
        },
    };

    let current = match upsert_and_load(
        &state.pool,
        &email,
        &name,
        subject.as_deref(),
        state.default_role,
        &state.admin_emails,
    )
    .await
    {
        Ok(current) => current,
        Err(err) => {
            tracing::error!(error = %err, %email, "auth: failed to upsert/load user");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    req.extensions_mut().insert(current);
    next.run(req).await
}

/// Insert the `users` row on first sight (`employee_id` unset; `roles`
/// seeded as `[Admin]` if `email` case-insensitively matches `admin_emails`,
/// else `[default_role]`), refreshing `name`/`subject` on every call; then
/// load the stored role set and employee link back. Roles and employee_id
/// are admin-managed after creation, so — beyond this initial seed — they
/// are never overwritten here: the `ON CONFLICT` clause touches only `name`
/// and `subject`. This is exactly what makes admin pre-creation work: a row
/// created by an admin (via `AdminService::UpsertUser`, or `ensure_admins`
/// at startup) before the person's first login keeps the roles it was given
/// — do not "fix" this to also refresh `roles` here.
async fn upsert_and_load(
    pool: &SqlitePool,
    email: &str,
    name: &str,
    subject: Option<&str>,
    default_role: UserRole,
    admin_emails: &[String],
) -> Result<CurrentUser, sqlx::Error> {
    let seed_roles: Vec<UserRole> = if admin_emails
        .iter()
        .any(|admin| admin.eq_ignore_ascii_case(email))
    {
        vec![UserRole::Admin]
    } else {
        vec![default_role]
    };

    sqlx::query(
        "INSERT INTO users (email, name, subject, roles, employee_id, created_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, subject = excluded.subject",
    )
    .bind(email)
    .bind(name)
    .bind(subject)
    .bind(roles_to_db(&seed_roles))
    .bind(now_millis())
    .execute(pool)
    .await?;

    let (roles, employee_id): (String, Option<String>) =
        sqlx::query_as("SELECT roles, employee_id FROM users WHERE email = ?1")
            .bind(email)
            .fetch_one(pool)
            .await?;

    Ok(CurrentUser {
        email: email.to_string(),
        name: name.to_string(),
        subject: subject.map(str::to_owned),
        roles: roles_from_db(&roles),
        employee_id,
    })
}

/// Idempotently ensure a `users` row exists for every email in
/// `admin_emails`, with `USER_ROLE_ADMIN` included in its role set — so the
/// bootstrap admin can be granted before ever logging in (`GetSession`/the
/// auth middleware only ever create a row on first login, which may never
/// happen for an operator who just wants to administer accounts).
///
/// For an email that already has a row, the admin role is ADDED to the
/// existing set rather than replacing it: an admin may have deliberately
/// assigned other roles (or even removed the admin role again) and this
/// must never clobber that. For an email with no row yet, one is created
/// with `name = email` as a placeholder, the same placeholder
/// `AdminService::UpsertUser` uses, until the person's first login supplies
/// the real name.
pub async fn ensure_admins(pool: &SqlitePool, admin_emails: &[String]) -> AppResult<()> {
    for email in admin_emails {
        let existing: Option<String> =
            sqlx::query_scalar("SELECT roles FROM users WHERE email = ?1")
                .bind(email)
                .fetch_optional(pool)
                .await?;

        match existing {
            Some(roles_raw) => {
                let mut roles = roles_from_db(&roles_raw);
                if roles.contains(&UserRole::Admin) {
                    tracing::info!(%email, "ensure_admins: already holds the admin role");
                    continue;
                }
                roles.push(UserRole::Admin);
                let canonical = roles_to_db(&roles);
                sqlx::query("UPDATE users SET roles = ?1 WHERE email = ?2")
                    .bind(&canonical)
                    .bind(email)
                    .execute(pool)
                    .await?;
                tracing::info!(%email, roles = %canonical, "ensure_admins: added the admin role to an existing user");
            }
            None => {
                let canonical = roles_to_db(&[UserRole::Admin]);
                sqlx::query(
                    "INSERT INTO users (email, name, subject, roles, employee_id, created_at)
                     VALUES (?1, ?1, NULL, ?2, NULL, ?3)",
                )
                .bind(email)
                .bind(&canonical)
                .bind(now_millis())
                .execute(pool)
                .await?;
                tracing::info!(%email, "ensure_admins: created a new admin user row");
            }
        }
    }
    Ok(())
}

/// The canonical, on-the-wire-independent token for one role, used by both
/// [`roles_to_db`] and [`roles_from_db`].
fn role_token(role: UserRole) -> &'static str {
    match role {
        UserRole::Employee => "EMPLOYEE",
        UserRole::Pm => "PM",
        UserRole::Bl => "BL",
        UserRole::Sales => "SALES",
        UserRole::Admin => "ADMIN",
        // Never produced by `config::parse_default_role`, the admin seed
        // above, or `AdminService::UpsertUser` (which rejects it); guarded
        // rather than unreachable!() so a future caller gets a safe
        // fallback instead of a panic.
        UserRole::Unspecified => {
            tracing::warn!("seeding a user with UserRole::Unspecified; defaulting to EMPLOYEE");
            "EMPLOYEE"
        }
    }
}

/// The inverse of [`roles_from_db`]: render a role set as the canonical
/// `users.roles` column value — uppercase tokens, comma-separated, sorted
/// and deduplicated, so two writes of the same set always produce
/// byte-identical strings (which is what lets [`ensure_admins`] compare a
/// freshly-computed set against what's already stored).
pub fn roles_to_db(roles: &[UserRole]) -> String {
    let mut tokens: Vec<&'static str> = roles.iter().map(|role| role_token(*role)).collect();
    tokens.sort_unstable();
    tokens.dedup();
    tokens.join(",")
}

/// Map the `users.roles` column back to a role set. Unrecognized tokens (a
/// hand-edited row, a role retired in a later release) are logged and
/// skipped rather than failing the read; if that leaves the set empty (or
/// the column was empty/garbage to begin with), falls back to `[Employee]`
/// — a user with no roles could do nothing, which would be a confusing
/// failure mode. The result is always sorted and deduplicated, matching
/// [`roles_to_db`]'s canonical ordering.
pub fn roles_from_db(value: &str) -> Vec<UserRole> {
    let mut roles: Vec<UserRole> = value
        .split(',')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .filter_map(|token| match token {
            "EMPLOYEE" => Some(UserRole::Employee),
            "PM" => Some(UserRole::Pm),
            "BL" => Some(UserRole::Bl),
            "SALES" => Some(UserRole::Sales),
            "ADMIN" => Some(UserRole::Admin),
            other => {
                tracing::warn!(role = other, "unknown role token in users table; skipping");
                None
            }
        })
        .collect();
    roles.sort_unstable_by_key(|role| role_token(*role));
    roles.dedup();
    if roles.is_empty() {
        tracing::warn!(
            value,
            "users.roles produced no recognized roles; defaulting to EMPLOYEE"
        );
        roles.push(UserRole::Employee);
    }
    roles
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_to_db_round_trips_through_roles_from_db() {
        let roles = vec![UserRole::Pm, UserRole::Admin, UserRole::Employee];
        let stored = roles_to_db(&roles);
        let mut round_tripped = roles_from_db(&stored);
        round_tripped.sort_unstable_by_key(|role| role_token(*role));
        let mut expected = roles.clone();
        expected.sort_unstable_by_key(|role| role_token(*role));
        assert_eq!(round_tripped, expected);
    }

    #[test]
    fn roles_to_db_canonical_order_is_independent_of_input_order() {
        let forward = roles_to_db(&[UserRole::Admin, UserRole::Pm, UserRole::Employee]);
        let backward = roles_to_db(&[UserRole::Employee, UserRole::Pm, UserRole::Admin]);
        assert_eq!(forward, backward);
        assert_eq!(forward, "ADMIN,EMPLOYEE,PM");
    }

    #[test]
    fn roles_to_db_dedups() {
        assert_eq!(
            roles_to_db(&[UserRole::Pm, UserRole::Pm, UserRole::Pm]),
            "PM"
        );
    }

    #[test]
    fn roles_from_db_dedups_and_sorts() {
        let roles = roles_from_db("PM,ADMIN,PM,ADMIN");
        assert_eq!(roles, vec![UserRole::Admin, UserRole::Pm]);
    }

    #[test]
    fn roles_from_db_garbage_or_empty_falls_back_to_employee() {
        assert_eq!(roles_from_db(""), vec![UserRole::Employee]);
        assert_eq!(roles_from_db("NOT_A_ROLE"), vec![UserRole::Employee]);
        assert_eq!(roles_from_db(",,"), vec![UserRole::Employee]);
    }
}
