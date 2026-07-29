-- Multi-role users: a user now holds a set of roles (`qfc.session.v1.User`'s
-- `roles` field is `repeated`), not a single one, so the `users.role` column
-- becomes `users.roles` — a canonical (uppercase, comma-separated, sorted,
-- deduplicated) token list produced by `auth::roles_to_db` / read back by
-- `auth::roles_from_db`.
--
-- SQLite cannot retype or drop a column in place, so the table is rebuilt:
-- create the new shape, copy every row across, drop the old table, rename
-- the new one into place. `0001_init.sql` itself is never edited —
-- `sqlx::migrate!` checksums every already-applied migration file, and
-- changing it would break every existing database.
--
-- Nothing else references `users` via a foreign key (verified against
-- `migrations/0001_init.sql`: only `assignment` and `absence` declare
-- `REFERENCES`, both to `plan_version`), so this needs no constraint dance
-- beyond the rebuild itself.
--
-- Every existing row's role is reset to `EMPLOYEE` here, deliberately
-- discarding whatever single role it held (including the old default,
-- `pm`): roles are now a deliberate grant made by an admin (via
-- `AdminService::UpsertUser`, or the `QFC_ADMIN_EMAILS` bootstrap), not
-- something a login should silently carry forward from the old
-- single-role scheme. `EMPLOYEE` is the least-privileged role, so nobody
-- gains capability they didn't already have; an admin can re-grant PM/BL/
-- Sales/Admin explicitly afterwards.
CREATE TABLE users_new (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT,
    roles TEXT NOT NULL,
    employee_id TEXT,
    created_at INTEGER NOT NULL
);

INSERT INTO users_new (email, name, subject, roles, employee_id, created_at)
SELECT email, name, subject, 'EMPLOYEE', employee_id, created_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
