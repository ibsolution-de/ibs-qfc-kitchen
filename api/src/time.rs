//! Wall-clock helper shared by every module that stamps rows: the
//! `created_at`/`updated_at INTEGER` columns (millis since the epoch).
//!
//! These used to exist as verbatim private copies in `store`, `auth`,
//! `seed`, `services::admin`, `services::growth`, and `services::planning`;
//! they live here once so a fix lands in a single place. There is
//! deliberately no `chrono`/`time` dependency in this crate, so the
//! representation is built directly from `SystemTime`.

/// Milliseconds since the Unix epoch, for the `created_at`/`updated_at
/// INTEGER` columns. `unwrap_or_default`: a system clock set before 1970
/// yields 0 rather than panicking a write path that has no meaningful
/// recovery for "clock is broken" anyway.
pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
