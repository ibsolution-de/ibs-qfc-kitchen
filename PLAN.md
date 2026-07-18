# QFC Kitchen — Remediation & Hardening Plan

Derived from the full code/architecture/UX review (2026-07-18). Every finding is mapped to an
executable step. Line numbers reference the codebase at review time — always locate by symbol
name, not line number.

## Execution Model

| Role | Model | Responsibility |
|------|-------|----------------|
| Orchestrator + Reviewer | `kimi-coding/k3` (main pi session) | dispatches steps, reviews diffs, runs gates, commits |
| Implementer | `kimi-coding/k2p7` ("Kimi K2.7 Code") | executes exactly ONE step per run |

### Rules for every step
1. **One step = one worker run = one commit.** No parallel writers on the working tree.
2. Worker receives: goal, **explicit file allow-list**, detailed tasks, acceptance gates. It must not touch files outside the allow-list.
3. After each worker run, the orchestrator:
   - runs the **gates** (see below),
   - reviews the diff (`git diff`),
   - updates `PROGRESS.md`,
   - commits as `step(<id>): <title>`.
4. If a gate fails → re-dispatch the same step with the failure output appended to the prompt (max 2 retries, then escalate to the user).
5. Steps are sequential unless marked `[parallel-safe]` (only steps with disjoint file sets may run concurrently).

### Global gates (run after EVERY step)
```bash
pnpm lint        # tsc --noEmit — must be clean
pnpm build       # vite build — must be clean
pnpm test        # vitest run — must pass (from Step 0.2 on)
```

### Worker dispatch template (pi subagent tool)
```json
{
  "agent": "worker",
  "model": "kimi-coding/k2p7",
  "task": "<step prompt from this plan>",
  "context": "fresh"
}
```

### Conventions
- New shared code goes to `src/`? **No** — keep the existing flat layout: `utils/`, `components/ui/`, `hooks/`.
- IDs: `crypto.randomUUID()` via `utils/uid.ts`. Never `Math.random().toString(36).substr(...)`.
- Money: always numeric cents/euros via `utils/money.ts`. Never parse budget strings inline.
- All user-facing strings via `t()` keys in `translations.ts` (en + de). No hardcoded UI text.
- Commits: conventional commits (`fix:`, `refactor:`, `feat:`, `test:`, `chore:`).

---

## Phase 0 — Safety Net

### Step 0.1 — Branch + CI gate
**Goal:** protect main; every future step is CI-checked.
**Files:** `.github/workflows/ci.yml` (new)
**Tasks:**
- Create branch `refactor/hardening` from `main`; all step commits go there.
- Add CI workflow: checkout → pnpm setup → node 24 → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` → `pnpm test`. Trigger on push/PR to `refactor/hardening` and `main`.
**Gates:** workflow file lints (actionlint if available); `git push` dry-run optional.
**Worker prompt:**
> Create `.github/workflows/ci.yml` for this pnpm+Vite+TS project: pnpm/action-setup@v4, actions/setup-node@v6 (node 24, cache pnpm), then `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`, `pnpm test`. Trigger on push and pull_request for branches `main` and `refactor/hardening`. Do not modify any other file. Note: `pnpm test` does not exist yet — add a placeholder script `"test": "echo \"no tests yet\" && exit 0"` to package.json (Step 0.2 will replace it).

### Step 0.2 — Test harness (Vitest)
**Goal:** runnable `pnpm test` before any logic fix lands.
**Files:** `package.json`, `vitest.config.ts` (new), `utils/money.ts` (new, placeholder), `utils/money.test.ts` (new)
**Tasks:**
- `pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`
- `vitest.config.ts`: jsdom environment, globals true, alias `@` → repo root (mirror vite.config).
- Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Seed `utils/money.ts` with `parseBudget(input: string | undefined | null): number | null` (canonical implementation: trims, case-insensitive `k`/`m` suffix, returns euros, `null` when unparseable) + `formatEuro(n: number): string`. Cover with unit tests: `'50k'→50000`, `'50K'→50000`, `'1.2m'→1200000`, `'TBD'→null`, `undefined→null`, `'75000'→75000`.
**Gates:** all 3 global gates green.
**Worker prompt:**
> Set up Vitest for this Vite 8 + React 19 + TS project (see package.json/vite.config.ts). Install dev deps with pnpm. Create vitest.config.ts (jsdom, globals, `@` alias to project root). Add `test`/`test:watch` scripts replacing the placeholder. Then create `utils/money.ts` exporting `parseBudget(input: string | null | undefined): number | null` (case-insensitive k/m suffixes, euros) and `formatEuro(n: number): string` (de-DE locale, no decimals), plus `utils/money.test.ts` with the cases: '50k'→50000, '50K'→50000, '1.2m'→1200000, '1,5m'→1500000, 'TBD'→null, ''→null, undefined→null, '75000'→75000. Run `pnpm test` and `pnpm lint` until green. Touch ONLY: package.json, pnpm-lock.yaml, vitest.config.ts, utils/money.ts, utils/money.test.ts.

---

## Phase 1 — P0: Correctness & Trust

### Step 1.1 — Planner data-loss fix (highest priority)
**Goal:** saving assignments/absences never silently destroys the other type.
**Files:** `components/ResourcePlanner.tsx`, `utils/planner.ts` (new), `utils/planner.test.ts` (new)
**Context:** `handleSaveAssignments` filters out existing absences for all target days (≈L390-391) and vice versa; absence days are clickable despite `cursor-not-allowed` (≈L813, `isInteractive` doesn't exclude absence days).
**Tasks:**
- Extract the day-merge logic into pure functions in `utils/planner.ts`: `mergeDayEntries({assignments, absences, draftAssignments, draftAbsence, employeeId, dates, mode})` implementing **merge, not replace**: saving projects keeps existing absences; saving an absence keeps existing assignments and the UI must surface the conflict.
- Modal UX: when the selected day(s) already contain the other type, show an inline warning ("This day has a vacation entry" / "N project assignment(s) exist") instead of silently dropping data. If absence overlaps assignments, mark the assignment chips as conflicting (visual), don't delete.
- Make absence cells non-interactive in the grid (`isInteractive` excludes days with absence), except to open a read view of the day.
- Unit tests for merge semantics: project-save preserves absence; absence-save preserves assignments; repeat-mode never deletes existing entries.
**Gates:** global gates + new tests pass.
**Worker prompt:**
> Fix silent data loss in components/ResourcePlanner.tsx. Current behavior: handleSaveAssignments (search for `handleSaveAssignments`) deletes existing absences for target days regardless of the active tab, and saving an absence deletes assignments. Also `isInteractive` (search) allows clicking absence days while styled `cursor-not-allowed`. Extract day-merge logic to `utils/planner.ts` as pure tested functions implementing MERGE semantics (saving one type preserves the other). In the modal, when target days contain the other entry type, show a translated inline warning (add keys `planner.conflictAbsence`, `planner.conflictAssignments` to translations.ts en+de) and visually flag overlapping chips; never delete silently. Make absence days non-interactive in the grid except opening the modal in a read-only day view. Add `utils/planner.test.ts` covering: project-save preserves absence; absence-save preserves assignments; repeat mode (weekday recurrence) preserves existing entries. Gates: pnpm lint, pnpm build, pnpm test. Touch ONLY: components/ResourcePlanner.tsx, utils/planner.ts, utils/planner.test.ts, translations.ts.

### Step 1.2 — Overload semantics honor availability
**Goal:** one consistent utilization model.
**Files:** `utils/planner.ts`, `utils/planner.test.ts`, `components/ResourcePlanner.tsx`, `types.ts`
**Context:** overload = `dailyLoad > 1.0` ignores `Employee.availability` (≈L233, L816); the utilization pill uses availability-adjusted capacity — same row, two answers. Slider allows 10h (allocation 1.25) while `types.ts` documents 0.1–1.0.
**Tasks:**
- Add to `utils/planner.ts`: `dailyCapacityFraction(emp) = emp.availability / 100`, `isOverloaded(load, emp) = load > dailyCapacityFraction(emp)`, `allocationToHours(allocation, emp) = allocation * 8` (document that allocation is fraction of a full 8h day).
- Use these helpers in `getMonthStats`, `getDailyLoad`, cell overload styling, and the utilization pill — identical math everywhere.
- Clamp the allocation slider to max 8h (1.0) OR explicitly allow 1.25 and update `types.ts` comment — pick clamp (safer for QFC math) and cap slider `max` accordingly.
- Tests: 50%-FTE at 0.6 → overloaded; at 0.5 → not; 100%-FTE at 1.0 → not.
**Gates:** global gates.

### Step 1.3 — Kill fake affordances
**Goal:** every visible button does something real, or is gone.
**Files:** `components/ResourcePlanner.tsx`, `components/ManageCustomers.tsx`, `components/StrategyModule.tsx`, `components/QuarterlyForecast.tsx`, `utils/export.ts` (new), `utils/export.test.ts` (new), `App.tsx`
**Context:** dead Export button (`ResourcePlanner` ≈L615), dead Add Customer (`ManageCustomers` ≈L87), dead Add Goal (`StrategyModule` ≈L71), `alert()` stubs for Export PPT / SAP (`QuarterlyForecast` ≈L327/L424), fake "LATENCY 12ms"/"AF-{random}" labels (`QuarterlyForecast` ≈L967-972), changelog "build date" = today (`Sidebar` ≈L438).
**Tasks:**
- `utils/export.ts`: `downloadJSON(filename, data)`, `assignmentsToCSV(employees, projects, assignments, absences): string` (pure, tested).
- Wire planner Export → downloads CSV of current version (assignments + absences). Wire customers updater: pass `onUpdateCustomers` from App and implement Add/Edit/Delete customer modal (reuse CRUD pattern from ManageProjects).
- Add Goal: implement minimal create-goal modal writing to local `goals` state (or remove the button if out of scope — implement it; goals already have types).
- Replace Export PPT with the CSV export; remove SAP button (integration is Phase 4 scope) or hide it behind `isAiEnabled`-style settings flag `sapIntegrationEnabled` default off — pick removal.
- Remove fabricated labels (latency/secure-connection/AF-id) from the AI panel; show real state only (model name from a shared constant).
- Sidebar changelog: replace `new Date()` build date with a hardcoded release date constant or remove the line.
**Gates:** global gates + CSV round-trip test.

### Step 1.4 — Date formatting via date-fns locale
**Goal:** delete the hand-rolled German formatter.
**Files:** `contexts/LanguageContext.tsx`, `components/OneOnOneDashboard.tsx` (verification only)
**Context:** hand-rolled token replacement produces "DonnerstagE, …" (EEE checked before EEEE) and never handles numeric `MM`.
**Tasks:**
- `formatDate = (date, fmt) => language === 'de' ? fnsFormat(date, fmt, { locale: de }) : fnsFormat(date, fmt)` with `import { de } from 'date-fns/locale'`.
- Delete the custom replacement chain entirely. Verify all existing format strings are valid date-fns tokens (`MMMM yyyy`, `EEE`, `EEEE, MMMM d, yyyy`, `MMM d, HH:mm`, `MMM d, yyyy`, `MMM d`, `d`, `yyyy`).
**Gates:** global gates + manual check: 1:1 date renders "Donnerstag, 17. Juli 2026"-style.

### Step 1.5 — StrategyModule repairs
**Goal:** strategy features actually work.
**Files:** `components/StrategyModule.tsx`, `services/ai.ts`
**Tasks:**
- Fix the stale-closure bug: `handleSend` accepts `manualInput?: string` (copy the pattern from `components/ResourcePlanChat.tsx:58`); wire "Generate Strategy Document" through it.
- Sunburst `createSector`: clamp sweep to `2π - 1e-4` for full-circle; skip zero-volume projects (no negative arcs); render nothing-but-legend when total volume is 0.
- Make the "AI not configured" and error messages translated (`t()` keys), log real errors to console.
- Remove unused prop `onUpdateProjects` (or wire it — removal preferred; routes pass it but module never uses it), remove unused imports `Mic`, `ChevronRight`.
- Move mutable `startAngle` accumulation out of JSX render into the memoized data computation.
**Gates:** global gates; sunburst renders with 1 metric at 100% and with 0-volume projects.

### Step 1.6 — Financial correctness
**Goal:** numbers you can trust.
**Files:** `components/FinancialOverview.tsx`, `components/SalesPipeline.tsx`, `components/ManageProjects.tsx`, `components/ManageCustomers.tsx`, `utils/money.ts`, `utils/money.test.ts`
**Tasks:**
- Replace ALL local `parseBudget` copies with `utils/money.ts` (single import). Delete the divergent duplicates.
- Budget sort: sort by `parseBudget(budget) ?? -1`, not the raw string.
- Header KPIs (Total Revenue, Avg Margin) computed from the **unfiltered** project list; filtered list only affects table/chart.
- Unify margin thresholds: one exported const `MARGIN_THRESHOLDS = { risk: 10, healthy: 25 }` used by filter, badge, and header coloring (header currently uses a third threshold 20).
- Fix unreachable `marginFilter === 'low'`: either add the UI button or remove the branch (add the button — the type already exists).
- `SortField`: remove unused `'margin'` member; remove unused `customers` prop from `FinancialOverview` (App.tsx stops passing it).
**Gates:** global gates + money tests extended for sort helper if added.

### Step 1.7 — App-level consistency
**Goal:** state writes go to the right place; no NaN, no runaway loops.
**Files:** `App.tsx`, `components/ManageProjects.tsx`, `components/ManageTeam.tsx`, `components/ResourcePlanner.tsx`, `components/OneOnOneDashboard.tsx`, `components/SalesPipeline.tsx`, `components/development/IkigaiBuilder.tsx`, `utils/uid.ts` (new)
**Tasks:**
- `utils/uid.ts`: `export const uid = () => crypto.randomUUID()`. Replace every `Math.random().toString(36).substr(2, 9)` (6+ sites) with `uid()`.
- `handleAssignmentChange`/`handleAbsenceChange` write to the **active** version, not the last; guard with the same readOnly logic (no-op + console.warn when not latest).
- Number inputs: `const n = e.target.valueAsNumber; if (Number.isNaN(n)) return;` pattern — no NaN into state (ManageProjects probability/volume, forecast inputs). Probability/volume min-max clamps (0–100, ≥0).
- `absenceDuration`: clamp 1–60 in the modal; guard the expansion loop.
- `versionStartDate`: stop freezing "today" at mount — compute per render via a small `useToday()` hook (interval at midnight) or simply `new Date()` where used.
**Gates:** global gates.

### Step 1.8 — i18n leak sweep + language persistence
**Goal:** no hardcoded UI strings; language survives reload.
**Files:** `translations.ts`, `contexts/LanguageContext.tsx`, plus every file with leaks: `components/ResourcePlanner.tsx` ("Read Only", "KW", "Days count:", "Daily Schedule", "Total", "No projects assigned", "View Employee Overview", "Remove"), `components/FinancialOverview.tsx` ("Total Revenue", "Avg Margin", "No projects found…"), `components/SalesPipeline.tsx` ("AI Not Configured…"), `components/Sidebar.tsx` (changelog strings, titles), `components/StrategyModule.tsx` (error bubbles)
**Tasks:**
- Add missing keys to en + de sections of `translations.ts`; replace literals with `t()`.
- Persist `language` to localStorage (`ibs_qfc_language`) and initialize from it.
- Keep `t()` fallback behavior; add `console.warn` on missing key in dev.
**Gates:** global gates; `rg -n '"[A-Z][a-z]+ [a-z]+"' components` spot-check shows no obvious literals.

---

## Phase 2 — P1: Foundation

### Step 2.1 — TypeScript strict mode
**Goal:** explicit, maximal type safety.
**Files:** `tsconfig.json`, fallout fixes across `components/**`, `contexts/**`, `services/**`, `App.tsx`
**Tasks (staged within the step):**
1. Enable `"strict": true` + `"noUnusedLocals": true` + `"noUnusedParameters": true`. Fix fallout (expect mostly unused imports/vars — delete them).
2. Enable `"noUncheckedIndexedAccess": true`. Fix fallout with type predicates (`filter((x): x is … => …)`), Map-based lookups, and `PASTEL_VARIANTS[color] ?? PASTEL_VARIANTS.gray` patterns.
3. Replace `as any` casts on form selects with proper generics (`value={formData.stage} onChange={e => setFormData({...formData, stage: e.target.value as Project['stage']})}`).
4. Type the planner project filter as a discriminated union instead of `string`.
**Gates:** global gates with new flags active.
**Note:** biggest error-count step — budget a full worker run; instruct staged commits inside the step is NOT allowed (one commit at end), but allow the worker to run gates between sub-stages.

### Step 2.2 — Build-time Tailwind (replace CDN)
**Goal:** purge-able, fail-loud styling; kill ~10 silently-dead classes.
**Files:** `package.json`, `vite.config.ts`, `index.html`, `src/index.css` or `index.css` (new), `components/ResourcePlanner.tsx`, `components/ui/Modal.tsx`, `components/QuarterlyForecast.tsx`, `components/Sidebar.tsx`, `constants.ts`
**Tasks:**
- `pnpm add -D tailwindcss @tailwindcss/vite`; register plugin in `vite.config.ts`; create `index.css` with `@import 'tailwindcss';` and a `@theme` block porting the CDN config: charcoal + pastel palettes, Inter/JetBrains Mono fonts, ALL keyframes (fadeIn, fadeInUp, slideInRight, scaleIn, pulseSubtle, shimmer, scan) as `--animate-*` tokens.
- Port the `<style>` block (scrollbars, glass-panel, hover-card, tech-pattern, button transitions) into `index.css` (plain CSS, keep verbatim).
- Define the missing utilities the code already uses: `animate-in fade-in zoom-in-95` → add real utilities in CSS (e.g. `@utility animate-in` with fade/zoom keyframes) so the Modal animation finally works; define `pattern-diagonal-lines-sm`, `bg-stripes-gray`, `custom-scrollbar`, `markdown-prose` (minimal prose styles for AI text) or remove usages — prefer defining.
- Delete the CDN `<script src="https://cdn.tailwindcss.com">` and inline `tailwind.config` from `index.html`; import `./index.css` in `index.tsx`.
- Fix `pl-6.5` (not on spacing scale) → `pl-6`; fix class-string surgery (`ResourcePlanner` `.replace('text-','bg-')`) by adding a `dot: 'bg-pastel-blueText'` field to `PASTEL_VARIANTS`.
- Fix `focus:ring-ring` in `components/ui/Badge.tsx` (no `ring` color) → `focus:ring-charcoal-400`.
**Gates:** global gates + visual smoke test (orchestrator runs preview, screenshots planner/forecast/chat; compare before/after manually).
**Risk:** visual regressions — orchestrator MUST do the screenshot comparison before commit.

### Step 2.3 — Shared UI primitives
**Goal:** kill the 17× copy-pasted form markup.
**Files:** `components/ui/PageHeader.tsx` (new), `components/ui/FormField.tsx` (new), `components/ui/ProgressBar.tsx` (new), `components/ui/StatusBadge.tsx` (new), `components/ui/ConfirmDialog.tsx` (new), `components/ui/Toast.tsx` (new), `components/ui/Button.tsx` (add `type` default `'button'`)
**Tasks:**
- `PageHeader`: title + subtitle + actions slot (adopt in QuarterlyForecast, FinancialOverview, SalesPipeline, ManageProjects, ManageTeam, ManageCustomers, StrategyModule — adoption in this step).
- `FormField` (label with `htmlFor` + error slot) + `TextInput` + `SelectInput` wrapping the canonical class string.
- `ProgressBar` with `role="progressbar"`/`aria-valuenow`; `StatusBadge` mapping status→classes.
- `ConfirmDialog` on the existing Modal; replace native `confirm()` in ManageTeam/ManageProjects.
- `ToastProvider` + `useToast()` (success/error/info, auto-dismiss, aria-live); wire save/delete/export actions to toasts across the app.
**Gates:** global gates + one interaction test for ConfirmDialog and Toast (testing-library).

### Step 2.4 — `useCrudForm<T>` + Manage* refactor
**Goal:** one typed CRUD implementation instead of three copies.
**Files:** `hooks/useCrudForm.ts` (new), `hooks/useCrudForm.test.ts` (new), `components/ManageProjects.tsx`, `components/ManageTeam.tsx`, `components/ManageCustomers.tsx`
**Tasks:**
- Hook encapsulates: `isModalOpen`, `editingId`, `formData: Partial<T>`, `openAdd()`, `openEdit(item)`, `handleSubmit(validate?)`, `handleDelete(id)` — with `uid()` ids and typed submit (no `as T` casts: submit callback receives `T` after a required-fields validator).
- Refactor all three Manage* components onto it, using Step 2.3 primitives; single source of default form values (fix the ManageProjects drift: initial defaults `volume:0/stage:'qualified'` vs handleAdd `volume:40/stage:'lead'`).
- Validation: project endDate ≥ startDate; required name/client; customer name unique-ish (warn).
**Gates:** global gates + hook unit tests (open/edit/submit/delete flows).

### Step 2.5 — Modal & focus accessibility
**Goal:** keyboard users can use the app.
**Files:** `components/ui/Modal.tsx`, `components/ui/Badge.tsx`, `components/ResourcePlanChat.tsx`, `components/Sidebar.tsx`, `components/ResourcePlanner.tsx`
**Tasks:**
- Modal: Escape closes, backdrop click closes, focus trap (tab cycles inside), initial focus on first focusable, `role="dialog" aria-modal="true" aria-labelledby`, restore focus on close. Small internal `useFocusTrap` hook.
- `ResourcePlanChat`: conditional render instead of `opacity-0 pointer-events-none` (no focus into hidden UI); minimized restore target becomes a real `<button>`; close-wipes-conversation gets a ConfirmDialog.
- Sidebar role popover: Escape closes, `aria-expanded`/`aria-haspopup`, focus first item on open.
- Badge with `onClick` renders `<button type="button">`.
- Icon-only buttons get `aria-label` (planner prev/next, legend, chat trigger, sidebar `+`); project-filter `<select>` gets an associated label.
**Gates:** global gates + testing-library tests: Escape closes modal; closed chat has no focusable elements.

### Step 2.6 — Business-math test coverage
**Goal:** the QFC math is pinned by tests.
**Files:** `utils/planner.ts`, `utils/forecast.ts` (new — extract from QuarterlyForecast: capacity calc, monthly breakdown, Monte Carlo), `utils/forecast.test.ts`, `utils/planner.test.ts` (extend), `utils/money.test.ts` (extend)
**Tasks:**
- Extract `getRealQuarterData`, `getMonthlyBreakdown`, `runMonteCarloSimulation` into pure `utils/forecast.ts` (component keeps rendering only). Fix en route: remove the `Math.max(0, …)` clamp that hides negative months (or expose `clamped` + `raw` explicitly); stop mutating histogram bins to percentages (keep counts, compute display % at render); quarter lookup by structured months/id, never by splitting `name`.
- Tests: capacity with holidays/absences/availability; monthly breakdown sums; Monte Carlo determinism with seeded RNG (inject `rng: () => number` param, default `Math.random`); percentile sanity (p50 within histogram range).
**Gates:** global gates; coverage of utils ≥ meaningful (no threshold tooling needed, just real cases).

---

## Phase 3 — P2: Performance

### Step 3.1 — ResourcePlanner render performance
**Goal:** quarter view stays interactive with 20+ employees.
**Files:** `components/ResourcePlanner.tsx`, new `components/planner/PlannerGrid.tsx`, `components/planner/PlannerRow.tsx`, `components/planner/PlannerCell.tsx`, `components/planner/DayEditModal.tsx`
**Tasks:**
- `useMemo` an index: `Map<`${employeeId}|${date}`, Assignment[]>` + same for absences; all cell lookups O(1). `getEmployeeStats`/`getMonthStats` consume the index.
- Extract `PlannerCell` (props: date, entries, state flags, callbacks) wrapped in `React.memo`; `PlannerRow` memoized per employee; stable callbacks via `useCallback`.
- Move the day-edit modal into `DayEditModal.tsx` so search/slider keystrokes re-render only the modal.
- Replace `setTimeout(100) + getElementById` today-jump with a `ref` on the today column + `useEffect` on `currentDate`.
- Remove dead state `draggingEmpId`, dead helper `toHours`, dead `workingDaysCount`.
**Acceptance measure:** before/after React Profiler or simple `console.time` around a search keystroke in quarter view; target: no visible jank, render < 100ms on M-series.
**Gates:** global gates + existing planner tests still green.

### Step 3.2 — QuarterlyForecast render performance
**Goal:** typing in forecast inputs doesn't recompute the world.
**Files:** `components/QuarterlyForecast.tsx`
**Tasks:**
- Memoize `getRealQuarterData` per quarter (deps: version assignments/absences/employees) — uses Step 2.6 pure functions.
- Number inputs commit on blur / Enter (local draft state), not per keystroke.
- Drop the 2,000-element `iterations` from state (compute percentiles inside the simulation, keep only histogram + percentiles).
**Gates:** global gates.

### Step 3.3 — Bundle splitting
**Goal:** < 500 kB initial JS.
**Files:** `App.tsx`, `vite.config.ts` (optional manualChunks)
**Tasks:**
- `React.lazy` every route component except `ResourcePlanner` (home) with a shared `<Suspense fallback={...}>` using the existing spinner.
- Optional: manualChunks for `react-router-dom` + `@google/genai` (AI code only needed after settings).
**Gates:** `pnpm build` reports main chunk < 500 kB; routes smoke-tested.

---

## Phase 4 — Future Split (SEPARATE implementation & design run — NOT this plan's scope)

> **Decision (owner, 2026-07-18):** the app stays a standalone web UI deployed
> to gh-pages from `main`. The frontend/backend split comes later with a
> DIFFERENT architecture than originally drafted:
>
> - **Backend:** Rust, single worker process, **SQLite** embedded storage
> - **Contract:** **Protobuf** messages mirroring `types.ts` / `PersistedState`
> - **Transport:** HTTP/3 over QUIC (**WebTransport**) where browsers support
>   it, graceful HTTP/2 fallback
>
> Preparation already DONE in this run (minimal, standalone-safe):
> - ✅ `services/persistence/` — `PersistenceProvider` interface is the single
>   seam; `localStorageProvider` implements today's behavior; swap one binding
>   to migrate. See `services/persistence/README.md` for the migration path.
> - ✅ Domain types are JSON-plain and versioned storage keys are stable.
> - ✅ Repository-friendly state flow: all mutations funnel through App.tsx
>   handlers already.
>
> The epics below remain as STANDALONE UX/product improvements (no backend
> required); pick them up per priority:

### Epic 4.3 — AI service layer (standalone-compatible)
**Steps:** single `services/ai/client.ts` factory (apiKey + model registry — one place for `gemini-*` strings) → migrate all 5 call sites → `sendMessageStream` with incremental render in both chats → AbortController on close/re-send → consistent translated error toasts.
### Epic 4.4 — Chart library
**Gate C:** library — recommended: Recharts (React-native, tree-shakeable).
**Steps:** revenue forecast (axis, gridlines, tooltips), Monte-Carlo histogram (with capacity-limit reference line), strategy donut (labeled, a11y table alternative), competency radar. Delete hand-rolled trig.
### Epic 4.5 — Planner keyboard & touch
**Steps:** roving tabindex on grid; arrow-key navigation; Enter opens day modal; Del removes focused chip; long-press/drag-handle alternative for touch (or dnd-kit with sensors).
### Epic 4.6 — Version management
**Steps:** rename/delete versions (ConfirmDialog), restore, and version diff view (added/removed/changed assignments between two versions — pure function in `utils/versions.ts` + tests, then UI).

---

## Progress Tracking
Append to `PROGRESS.md` after every step:
```
## <date> Step <id> — <title> — <commit sha>
Gates: lint ✅ build ✅ test ✅
Notes: <deviations, follow-ups>
```

## Execution Order Cheat-Sheet
```
0.1 → 0.2 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8
→ 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6
→ 3.1 → 3.2 → 3.3
→ 4.0 (persistence seam, DONE) → standalone epics: 4.3 → [Gate C] 4.4 → 4.5 → 4.6
→ [FUTURE RUN] Rust+SQLite+Protobuf+HTTP3 backend split
```
Steps 1.4, 1.8 are parallel-safe with 1.1–1.3/1.5–1.7 pairs ONLY if the orchestrator verifies disjoint diffs — default is sequential.
