-- Canonicalize stored user emails to lower case, making `users.email` an
-- effectively case-insensitive unique id for every existing row.
--
-- Background
-- ----------
-- `users.email` is a SQLite TEXT PRIMARY KEY (BINARY collation, i.e.
-- case-sensitive). The auth and admin write paths used to store the value
-- exactly as received — proxy header (oauth2-proxy + an IdP may emit any
-- case) or admin form input — so `NAZAR@example.com` and `nazar@example.com`
-- could have ended up as two distinct accounts. The code now normalizes
-- every email through `auth::normalize_email` (trim + lowercase) before it
-- touches the database (see `api/src/auth.rs`, `api/src/services/admin.rs`),
-- so all future writes land in canonical form. This migration folds the
-- historical rows into that same form.
--
-- Duplicate handling
-- ------------------
-- A real case-only duplicate pair (two rows differing only by case) would
-- violate the primary key on the naive `UPDATE users SET email =
-- lower(email)` and fail startup. That state has occurred in practice (the
-- pre-normalization store took IdP header case verbatim), so the migration
-- folds duplicates first instead of failing:
--
--   1. Per lowercase address, pick one survivor: the row whose email is
--      already lowercase (the canonical form the code now writes),
--      otherwise the oldest row (the original account, so identity-attached
--      attributes like `employee_id` survive).
--   2. Merge the folded rows' `roles` into the survivor. Roles are
--      admin-managed and re-derived only for first-seen users, so dropping
--      a folded row's roles would silently revoke access.
--   3. Delete the folded rows, then lowercase every remaining email — no
--      primary-key collision remains.
--
-- `name`/`subject` are deliberately NOT merged: the auth middleware rewrites
-- them from the proxy header on every login (`auth::upsert_and_load`), so
-- the survivor picks up the real display name on the next request.

-- 1) Merge roles of every duplicate group into its survivor.
UPDATE users AS survivor
SET roles = (
    SELECT group_concat(DISTINCT trim(value))
    FROM (
        SELECT trim(value) AS value
        FROM users AS dup,
             json_each('["' || replace(dup.roles, ',', '","') || '"]')
        WHERE lower(dup.email) = lower(survivor.email)
    )
)
WHERE lower(email) IN (
    SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1
)
AND email = (
    SELECT u2.email FROM users AS u2
    WHERE lower(u2.email) = lower(survivor.email)
    ORDER BY (u2.email = lower(u2.email)) DESC, u2.created_at ASC, u2.email ASC
    LIMIT 1
);

-- 2) Drop the folded rows (everything but each group's survivor).
DELETE FROM users
WHERE lower(email) IN (
    SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1
)
AND email <> (
    SELECT u2.email FROM users AS u2
    WHERE lower(u2.email) = lower(users.email)
    ORDER BY (u2.email = lower(u2.email)) DESC, u2.created_at ASC, u2.email ASC
    LIMIT 1
);

-- 3) Safe now: at most one row per lowercase address.
UPDATE users SET email = lower(email);
