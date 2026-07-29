//! `SessionService`: the current caller's identity, derived from the
//! [`CurrentUser`](crate::auth::CurrentUser) the auth middleware attaches to
//! every request. First real service on the auth-to-handler path.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};

use crate::auth::{self, CurrentUser};
use crate::proto::session::{GetSessionRequest, GetSessionResponse, SessionService, User, UserRole};

pub struct SessionServiceImpl;

impl SessionService for SessionServiceImpl {
    async fn get_session(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, GetSessionRequest>,
    ) -> ServiceResult<GetSessionResponse> {
        let current = auth::require(&ctx)?;
        Response::ok(GetSessionResponse {
            user: user_from(current).into(),
            ..Default::default()
        })
    }
}

fn user_from(current: CurrentUser) -> User {
    user_from_fields(&current.email, &current.name, &current.roles, current.employee_id)
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
    let avatar = format!("https://ui-avatars.com/api/?name={}", encode_query_component(name));
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
