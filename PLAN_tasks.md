# Implementierungsplan: PM-eigene Resourcepläne + Accounts (Beauftragungen)

Zwei Aufgaben, ein gemeinsames Datenmodell. Baselines sind grün (86 API-Tests, 248 Web-Tests, tsc clean).

## Fachliches Modell

### Aufgabe 1 — Jeder PM hat einen eigenen Resourceplan
- `plan_version` bekommt einen **Owner** (E-Mail des PM). Der Plan + seine Versionierungs-Historie gehören diesem PM.
- Der Baseline `v1` und automatische Quartals-Snapshots gehören dem System-Owner (`system`), sind für Nutzer **read-only**.
- Nebenläufiges Planen: mehrere PMs planen parallel auf dieselben Projekte, jeder in **seinem** Plan. Nur die neueste Version **des eigenen Owners** ist editierbar (Frozen-Regel jetzt pro Owner statt global).
- BL darf alle Nicht-System-Pläne verwalten; PM nur den eigenen.
- Mitarbeiter sehen ihre Zuweisungen **über alle PM-Pläne**: Aggregat = neueste Version jedes (Nicht-System-)Owners. Client-Helper `currentPlanAssignments/currentPlanAbsences`; Analyse-Views (MyOverview, Financials, Forecast, ManageCustomers, ManageTeam, Strategy) nutzen das Aggregat. Der Planner zeigt den **eigenen** Plan editierbar + fremde Zuweisungen als **read-only-Kontext** (Chips).
- Quartals-Snapshot & Retention-Prune werden **pro Owner** ausgeführt.

### Aufgabe 2 — Accounts (Beauftragungen) pro Projekt
- Ein **Account** gehört zu genau einem Projekt: `name`, `status` (`confirmed` = eingegangen / `requested` = in Anfrage, z.B. mündlich zugesagt), optional `start_date`/`end_date`/`budget` (Anzeige-String wie "80k", Client parst via `parseBudget`).
- `Project.budget` bleibt das **geschätzte** Budget für die ganze Periode; Account-Budget ist das **konkrete**.
- Ressourcen werden **auf Accounts** geplant: `Assignment.account_id` optional. `NULL` = Legacy-Projektplanung (bestehende Zeilen); gesetzt = Account-Planung. Eindeutigkeit pro Version: `(version, employee, account_id, date)` bzw. Legacy `(version, employee, project_id, date)` (partielle Unique-Indizes).
- Budget-Abruf-Check (FinancialOverview): pro Account `budget` vs. geplante Kosten (geplante Tage × 8h × project.hourly_rate). `plannedCost <= budget` ⇒ Budget abrufbar.
- Alle Geld-/Kalkulationsstellen werden auf Accounts umgestellt (Audit unten).

## Verträge (Contracts)

### Proto: `proto/qfc/portfolio/v1/portfolio.proto`
```proto3
enum AccountStatus {
  ACCOUNT_STATUS_UNSPECIFIED = 0;
  ACCOUNT_STATUS_CONFIRMED = 1;   // Beauftragung eingegangen
  ACCOUNT_STATUS_REQUESTED = 2;   // in Anfrage (z.B. mündlich zugesagt)
}
message Account {
  string id = 1;
  string project_id = 2;
  string name = 3;
  AccountStatus status = 4;
  optional string start_date = 5; // YYYY-MM-DD
  optional string end_date = 6;   // YYYY-MM-DD
  optional string budget = 7;     // Anzeige-String, z.B. "80k"
}
// Project: + field 19: repeated Account accounts = 19;
message UpsertAccountRequest { Account account = 1; }
message UpsertAccountResponse { Account account = 1; }
message DeleteAccountRequest { string id = 1; }
message DeleteAccountResponse {}
// ProjectService: + rpc UpsertAccount(UpsertAccountRequest) returns (UpsertAccountResponse);
//                 + rpc DeleteAccount(DeleteAccountRequest) returns (DeleteAccountResponse);
```

### Proto: `proto/qfc/planning/v1/planning.proto`
```proto3
// PlanVersionMeta: + field 5 owner, + field 6 owner_name
//   owner: E-Mail des PM; "system" für Baseline/Quartals-Snapshots
//   owner_name: Anzeigename (users.name, "System", sonst E-Mail)
// Assignment: + field 7 optional string account_id
```

### Proto: `proto/qfc/events/v1/events.proto`
```proto3
// EntityKind: ENTITY_KIND_ACCOUNT = 11;
// ChangeEvent.body: qfc.portfolio.v1.Account account = 20;
```

### Migration `api/migrations/0006_plan_owners_and_accounts.sql`
```sql
ALTER TABLE plan_version ADD COLUMN owner TEXT NOT NULL DEFAULT 'system';

CREATE TABLE account (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACCOUNT_STATUS_CONFIRMED', 'ACCOUNT_STATUS_REQUESTED')),
    start_date TEXT,
    end_date TEXT,
    budget TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_account_project_id ON account (project_id);

ALTER TABLE assignment ADD COLUMN account_id TEXT REFERENCES account (id) ON DELETE CASCADE;

DROP INDEX idx_assignment_unique;
CREATE UNIQUE INDEX idx_assignment_unique_account ON assignment (version_id, employee_id, account_id, date) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX idx_assignment_unique_legacy ON assignment (version_id, employee_id, project_id, date) WHERE account_id IS NULL;
CREATE INDEX idx_assignment_account_id ON assignment (account_id);
```

### Backend Rust (`api/src`)
- **planning.rs**: Owner-Spalte lesen/schreiben; Mutationen (update_meta, delete_version,
  apply_assignments, apply_absences, upsert/delete_quarter_data) mit
  `require_mutable_by(current, owner)` + `require_latest_owned_version(conn, version_id, owner)`.
  - `require_mutable_by`: pm ⇒ owner == current.email; bl ⇒ owner != "system"; system ⇒ "frozen".
  - `fetch_version_owner(conn, version_id) -> AppResult<String>` (NotFound wenn fehlt).
  - Copy-from: beliebige Version erlaubt (`version_exists` reicht; alte "latest only"-Regel entfällt).
  - Quartals-Snapshot & Prune pro Owner (`SELECT DISTINCT owner FROM plan_version`).
  - Account-Handling in `do_apply_assignments`: wenn `account_id` gesetzt ⇒ Account muss existieren
    und `account.project_id == assignment.project_id` (in-Tx Query); `resolve_assignment_id` keyed
    auf `(version, employee, account_id, date)` via `account_id IS ?3`; ON CONFLICT update schreibt
    `account_id = excluded.account_id`; `copy_assignments` kopiert `account_id`.
  - `list_version_metas`/`fetch_version`: SELECT mit `owner` + LEFT JOIN `users` für owner_name;
    owner_name = "System" wenn owner == "system".
- **portfolio.rs**: Account-Reads in `list_projects`/`upsert_project` anhängen
  (`Project.accounts`), Accounts vor Blob-Encode strippen (in `upsert_project` vor `crud::upsert`);
  neue RPCs `upsert_account`/`delete_account` (Gate pm/bl/sales): Validierung name/status/dates/budget,
  Projekt-Existenz, UUID-Create, `change_log` mit `EntityKind::Account` (version_id None), Deletion
  kaskadiert (FK) und `NotFound` wenn 0 Zeilen.
- **events.rs**: `decode_body` + `ENTITY_KIND_ACCOUNT` → `Account`.
- **seed.rs**: unverändert (plan_version INSERT nutzt DEFAULT 'system').

### Web TypeScript
- **types.ts**: `AccountStatus`, `Account`; `Project.accounts: Account[]`; `Assignment.accountId?: string`;
  `PlanVersion.owner: string; ownerName: string`.
- **adapters.ts**: `accountFromProto/accountToProto` (wie bestehende Enum-Mappings mit
  `requiredEnumFromProto`); Projekt-Mappings inkl. accounts; planVersion meta owner/ownerName;
  assignment accountId durchreichen. Server strippt Accounts aus Project-Blobs.
- **clients.ts**: portfolio client `upsertAccount({account})`, `deleteAccount({id})`.
- **liveStore.tsx**: `saveAccount(account)` / `deleteAccount(id)` (patchen `projects[i].accounts`);
  `applyChangeEvent` Case `ENTITY_KIND_ACCOUNT` (Upsert/Delete → accounts-Liste des Projekts);
  Case `PROJECT` muss vorhandene `accounts` des Eintrags erhalten (Server-Blob kommt ohne accounts).
- **utils/planAggregate.ts** (NEU): `SYSTEM_OWNER='system'`; `latestVersionPerOwner(versions)`
  (Nicht-System); `currentPlanAssignments/currentPlanAbsences` (Flatten); `canEditVersion(version, email, versions)`
  (owner===email && latest of owner); Tests `planAggregate.test.ts`.
- **utils/accounts.ts** (NEU): `projectBudget(project)` (Σ Account-Budgets, Fallback
  `parseBudget(project.budget)`), `confirmedBudget/requestedBudget`, `accountPlannedDays`, `projectPlannedDays`, `plannedCost`; Tests.

### UI-Verteilung
- **S3 (Geld)**: ManageProjects (Accounts-Editor im Projekt-Modal; Budget = Σ Accounts; neue Props
  `onSaveAccount`/`onDeleteAccount`), FinancialOverview (Account-Zeilen mit Status/Budget/Daten/geplante
  Tage/Kosten/Abruf-Indikator; Umsatzprognose über **confirmed** Account-Budgets & Account-Daten, Fallback
  Projekt), ManageCustomers (totalBudget via projectBudget), SalesPipeline (projectBudget), utils/accounts.ts + Tests,
  translations unter projects/financials/customers/sales.
- **S4 (Planner)**: App.tsx-Wiring (activeVersion = eigener neuester Plan, Auto-Create wenn pm/bl ohne
  eigenen Plan, Aggregat an Analyse-Views, `contextAssignments` an Planner), ResourcePlanner
  (Context-Chips fremder Zuweisungen read-only), DayEditModal (Account-Auswahl wenn Projekt Accounts hat,
  Fallback Legacy), Sidebar (ownerName-Label, Rename/Delete nur eigene, Latest-Badge pro Owner),
  MyOverview (bekommt Aggregat), export.ts CSV + Account-Spalte, translations unter planner/sidebar/versions/myOverview.

### Kalkulations-Audit (vollständig)
| Stelle | Änderung |
|---|---|
| FinancialOverview | budget → projectBudget (Σ Accounts, Fallback); + Account-Zeilen; Forecast über confirmed Account-Budgets/-Daten |
| ManageCustomers | totalBudget → projectBudget; Formeln unverändert |
| ManageProjects | calculateMargin → projectBudget; + Accounts-Editor |
| SalesPipeline | totalValue/weightedValue → projectBudget |
| StrategyModule | nur volume — unverändert |
| ManageTeam | allocatedDays vs volume — unverändert |
| MyOverview | nur Zählungen — unverändert (Input = Aggregat) |
| QuarterlyForecast | Projekt-Ebene (geschätzt) — unverändert |
| money.ts / parseBudget | unverändert, für Accounts wiederverwendet |

### Testpflicht (Backend)
1. create_version setzt Owner & Meta exponiert owner/owner_name.
2. pm kann fremde PM-Version nicht mutieren; pm kann eigene bearbeiten, auch wenn ein anderer PM danach eine neuere Version erzeugt hat (Regression gegen die alte globale Latest-Regel).
3. bl kann fremde PM-Versionen mutieren; system-Versionen sind für alle read-only.
4. Quartals-Snapshot pro Owner; Pruning pro Owner (neueste je Owner bleiben).
5. Copy-from beliebiger (auch eingefrorener) Version erlaubt.
6. Assignment mit account_id: existiert nicht ⇒ NotFound; gehört zu anderem Projekt ⇒ InvalidArgument; Unique je (version, employee, account, date); zwei Accounts desselben Projekts am selben Tag erlaubt; Legacy-NULL-Pfad weiterhin funktionsfähig.
7. Portfolio: Account-Upsert-Validierung (name/status/dates/budget), Projekt-Existenz, Delete kaskadiert Assignments, ListProjects embeddet Accounts.
