//! `SessionService`: the current caller's identity, derived from the
//! [`CurrentUser`](crate::auth::CurrentUser) the auth middleware attaches to
//! every request. First real service on the auth-to-handler path.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth::{self, CurrentUser};
use crate::error::AppResult;
use crate::proto::session::{
    GetSessionRequest, GetSessionResponse, SessionService, User, UserRole,
};
use crate::proto::team::Employee;
use crate::store::{self, Table};

pub struct SessionServiceImpl {
    pool: SqlitePool,
}

impl SessionServiceImpl {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

impl SessionService for SessionServiceImpl {
    async fn get_session(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, GetSessionRequest>,
    ) -> ServiceResult<GetSessionResponse> {
        let mut current = auth::require(&ctx)?;
        // Direction A of the email-based `users.employee_id` auto-link (see
        // `services::team::upsert_employee` for Direction B): a user seen
        // here with no `employee_id` yet may already have a matching
        // `Employee` row — link it now rather than waiting for an admin to
        // do it by hand via `AdminService::UpsertUser`.
        if current.employee_id.is_none() {
            current.employee_id = auto_link_employee(&self.pool, &current.email).await?;
        }
        Response::ok(GetSessionResponse {
            user: user_from(current).into(),
            ..Default::default()
        })
    }
}

/// Find an `Employee` whose (normalized) `email` matches `email`, and —
/// best-effort, guarded so it never overwrites a value an admin already
/// set — point this user's `users.employee_id` at it.
///
/// Returns the id now linked, or `None` if no employee matched, or if the
/// guarded `UPDATE` lost a race against a concurrent write (in which case
/// the caller falls back to whatever `employee_id` it already had, i.e.
/// still `None` here).
async fn auto_link_employee(pool: &SqlitePool, email: &str) -> AppResult<Option<String>> {
    let mut conn = pool.acquire().await?;
    let employees = store::list_blobs::<Employee>(&mut conn, Table::Employee).await?;
    let normalized = auth::normalize_email(email);
    let Some(matched) = employees.into_iter().find(|employee| {
        employee
            .email
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some_and(|value| auth::normalize_email(value) == normalized)
    }) else {
        return Ok(None);
    };

    let result =
        sqlx::query("UPDATE users SET employee_id = ?2 WHERE email = ?1 AND employee_id IS NULL")
            .bind(email)
            .bind(&matched.id)
            .execute(&mut *conn)
            .await?;

    Ok(if result.rows_affected() > 0 {
        Some(matched.id)
    } else {
        None
    })
}

fn user_from(current: CurrentUser) -> User {
    user_from_fields(
        &current.email,
        &current.name,
        &current.roles,
        current.employee_id,
    )
}

/// Build the wire `User` message from raw identity fields rather than a
/// whole [`CurrentUser`], so `AdminService::ListUsers` — which reads
/// directly from stored `users` rows, never the calling admin's own
/// identity — can share this instead of re-deriving the avatar URL and
/// field mapping a second time.
pub(crate) fn user_from_fields(
    email: &str,
    name: &str,
    roles: &[UserRole],
    employee_id: Option<String>,
) -> User {
    let avatar = format!(
        "https://ui-avatars.com/api/?name={}",
        encode_query_component(name)
    );
    User {
        id: email.to_string(),
        name: name.to_string(),
        roles: roles.iter().map(|role| (*role).into()).collect(),
        avatar,
        employee_id,
        email: email.to_string(),
        ..Default::default()
    }
}

/// Percent-encode a query-string value the way `application/x-www-form-urlencoded`
/// does (space as `+`), matching how the web app already builds ui-avatars URLs.
fn encode_query_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_surname_first_name() {
        assert_eq!(encode_query_component("Kulyk, Nazar"), "Kulyk%2C+Nazar");
    }
}
