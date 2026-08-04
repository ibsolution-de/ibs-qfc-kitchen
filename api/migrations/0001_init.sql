-- Initial schema.
--
-- Design intent: low-churn entities (employee, customer, project, ...) are
-- stored as an id plus an encoded-protobuf BLOB, so their shape follows the
-- proto message without a migration per field. High-churn planner rows
-- (assignment, absence, quarter_data) are typed columns instead, since the
-- planner queries and filters on them directly.

-- Local application accounts, keyed by the email the auth proxy asserts.
-- Upserted on first sight by the auth middleware; `role` and `employee_id`
-- are then admin-managed, not overwritten on subsequent logins.
CREATE TABLE users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT,
    role TEXT NOT NULL,
    employee_id TEXT,
    created_at INTEGER NOT NULL
);

-- Employee master data (encoded qfc.team.v1.Employee).
CREATE TABLE employee (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);

-- Customer master data (encoded qfc.crm.v1.Customer).
CREATE TABLE customer (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);

-- Project master data (encoded qfc.portfolio.v1.Project).
CREATE TABLE project (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);

-- Strategic goals (encoded qfc.strategy.v1.StrategicGoal).
CREATE TABLE strategic_goal (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);

-- North star metrics (encoded qfc.strategy.v1.NorthStar).
CREATE TABLE north_star (
    id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);

-- 1:1 meeting records (encoded qfc.growth.v1.OneOnOne), one employee to many.
CREATE TABLE one_on_one (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    data BLOB NOT NULL
);
CREATE INDEX idx_one_on_one_employee_id ON one_on_one (employee_id);

-- A named, versioned planning scenario. Assignments, absences, and
-- quarter_data all hang off a plan_version. `created_at`/`updated_at` are
-- epoch-millis INTEGERs, matching `PlanVersionMeta.created_at_millis`.
CREATE TABLE plan_version (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- One employee's allocation to one project on one day, within a plan version.
CREATE TABLE assignment (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES plan_version (id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    allocation REAL NOT NULL
);
CREATE UNIQUE INDEX idx_assignment_unique ON assignment (version_id, employee_id, project_id, date);
CREATE INDEX idx_assignment_version_date ON assignment (version_id, date);

-- One employee's absence on one day, within a plan version.
CREATE TABLE absence (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES plan_version (id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    absence_type TEXT NOT NULL,
    approved INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_absence_unique ON absence (version_id, employee_id, date);
CREATE INDEX idx_absence_version_date ON absence (version_id, date);

-- Per-quarter planning snapshot data (encoded proto), keyed by an id that is
-- only unique within its plan version.
CREATE TABLE quarter_data (
    id TEXT NOT NULL,
    version_id TEXT NOT NULL REFERENCES plan_version (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (version_id, id)
);
CREATE INDEX idx_quarter_data_version_id ON quarter_data (version_id);

-- Public holidays by location, used to compute effective capacity.
CREATE TABLE public_holiday (
    date TEXT NOT NULL,
    location TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (date, location)
);

-- Append-only audit/event log of mutations across every entity kind.
CREATE TABLE change_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind INTEGER NOT NULL,
    op INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    version_id TEXT,
    actor_email TEXT NOT NULL,
    ts_millis INTEGER NOT NULL,
    payload BLOB
);

-- Small process-wide key/value store (schema version markers, feature
-- flags, etc.) that doesn't warrant its own table.
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
