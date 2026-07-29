//! Application error type and its mapping onto ConnectRPC error codes.

use connectrpc::{ConnectError, ErrorCode};
use thiserror::Error;

/// The error type threaded through service handlers and the data layer.
///
/// Converts into [`ConnectError`] at the handler boundary (`?` on a
/// `ServiceResult` does this via the [`From`] impl below); internal causes
/// are logged server-side and never reach the client message.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("decode error: {0}")]
    Decode(#[from] buffa::DecodeError),
    #[error("{0} not found: {1}")]
    NotFound(&'static str, String),
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("unauthenticated")]
    Unauthenticated,
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("internal error: {0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<AppError> for ConnectError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::NotFound(kind, id) => {
                ConnectError::new(ErrorCode::NotFound, format!("{kind} {id} not found"))
            }
            AppError::InvalidArgument(message) => {
                ConnectError::new(ErrorCode::InvalidArgument, message)
            }
            AppError::Unauthenticated => {
                ConnectError::new(ErrorCode::Unauthenticated, "authentication required")
            }
            AppError::PermissionDenied(message) => {
                ConnectError::new(ErrorCode::PermissionDenied, message)
            }
            // Everything else is a server-side fault: log the real cause,
            // hand the client a generic message so SQL text (or similar
            // internals) never leaks to the browser.
            other => {
                tracing::error!(error = %other, "internal error");
                ConnectError::new(ErrorCode::Internal, "internal error")
            }
        }
    }
}
