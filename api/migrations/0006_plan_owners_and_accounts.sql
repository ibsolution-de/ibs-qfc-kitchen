-- Per-PM plan ownership + accounts (Beauftragungen) per project.
--
-- Two independent model changes in one migration, because both touch the
-- `assignment` table's uniqueness and both are needed by the same feature
-- release:
--
-- 1. Plan ownership (`plan_version.owner`)
--    Every PM owns their own resource plan and its revision history. The
--    `owner` column records the owning user's email; the deployment
--    baseline `v1` and the automatic quarterly snapshots are owned by the
--    literal owner `'system'` and are read-only for every user. Mutations
--    are gated per owner (see `services::planning`), so parallel planning
--    by multiple PMs into the same projects is naturally scoped.
--
-- 2. Accounts (Beauftragungen) per project
--    `assignment` gains an optional `account_id` pointing at a new
--    `account` table. Resources are planned onto accounts to check whether
--    the account budget can be drawn. `NULL` account_id means legacy
--    project-level planning (all rows created before this migration); the
--    two partial unique indexes below keep one cell per
--    (version, employee, account, date) -- or the legacy
--    (version, employee, project, date) key when no account is set --
--    without letting NULLs collapse distinct cells.
--
-- The account delete cascade (ON DELETE CASCADE) relies on SQLite's
-- `foreign_keys` pragma, which `db::connect` enables.

-- ---------------------------------------------------------------------------
-- 1. Plan ownership
-- ---------------------------------------------------------------------------
ALTER TABLE plan_version ADD COLUMN owner TEXT NOT NULL DEFAULT 'system';

-- ---------------------------------------------------------------------------
-- 2. Accounts (Beauftragungen)
-- ---------------------------------------------------------------------------
CREATE TABLE account (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Proto variant name, e.g. 'ACCOUNT_STATUS_CONFIRMED'.
    status TEXT NOT NULL CHECK (status IN ('ACCOUNT_STATUS_CONFIRMED', 'ACCOUNT_STATUS_REQUESTED')),
    start_date TEXT,
    end_date TEXT,
    -- Display-string budget, e.g. '80k' (same convention as project.budget).
    budget TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_account_project_id ON account (project_id);

ALTER TABLE assignment ADD COLUMN account_id TEXT REFERENCES account (id) ON DELETE CASCADE;

DROP INDEX idx_assignment_unique;
CREATE UNIQUE INDEX idx_assignment_unique_account
    ON assignment (version_id, employee_id, account_id, date)
    WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX idx_assignment_unique_legacy
    ON assignment (version_id, employee_id, project_id, date)
    WHERE account_id IS NULL;
CREATE INDEX idx_assignment_account_id ON assignment (account_id);
