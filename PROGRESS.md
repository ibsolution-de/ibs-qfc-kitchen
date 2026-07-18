# PROGRESS

Execution log for PLAN.md. One entry per completed step.

## 2026-07-18 — Plan created
PLAN.md written from the full review (code quality / architecture / UX / design).
Execution model: orchestrator+reviewer = kimi-coding/k3 (main session), implementer = kimi-coding/k2p7 worker subagents, one step per run, gates after each step.
Next up: Step 0.1 — Branch + CI gate.

## 2026-07-18 Step 0.1 — Branch + CI gate — 6f7ab9e
Gates: lint ✅ build ✅ (skipped: no source change) test ✅ (placeholder)
Notes: branch refactor/hardening created; CI runs lint+build+test on push/PR to main + refactor/hardening.
Next up: Step 0.2 — Test harness (Vitest).

## 2026-07-18 Step 0.2 — Test harness (Vitest) — 7fcd896
Gates: lint ✅ build ✅ test ✅ (10 tests, utils/money)
Notes: vitest + jsdom + testing-library installed; utils/money.ts (parseBudget/formatEuro) seeded with canonical implementation; vitest.config.ts uses vitest/config typing.
Next up: Step 1.1 — Planner data-loss fix.

## 2026-07-18 Step 1.1 — Planner data-loss fix — 45d6beb
Gates: lint ✅ build ✅ test ✅ (17 tests: money + planner merge semantics)
Notes: mergeDayEntries/computeTargetDates extracted to utils/planner.ts (pure, tested). Merge semantics replace same-type only; other type preserved + translated conflict warnings + amber-flagged overlapping chips. Absence days non-interactive except read-only day view. Retry 1: restored absence deletion via modal read-only view (handleDeleteAbsenceFromModal). Follow-up: utils/planner.ts createId() still uses Math.random substr — swept in Step 1.7.
Next up: Step 1.2 — Overload semantics honor availability.

## 2026-07-18 Step 1.2 — Overload semantics honor availability — fcfedcf
Gates: lint ✅ build ✅ test ✅ (23 tests)
Notes: dailyCapacityFraction/isOverloaded/allocationToHours in utils/planner.ts used for all overload decisions (cell, month stats, pill now agree). Slider clamped to 8h; types.ts allocation doc updated. Left as-is: hasCriticalConflict counts critical projects (different semantic); day over-booking beyond 8h still possible via multiple projects (capacity bar warns) — P3 UX candidate.
Next up: Step 1.3 — Kill fake affordances.

## 2026-07-18 Step 1.3 — Kill fake affordances — 46eb22b
Gates: lint ✅ build ✅ test ✅ (27 tests, +utils/export)
Notes: planner Export → real CSV; ManageCustomers full CRUD wired via onUpdateCustomers; StrategyModule Add Goal modal; forecast Export PPT→real JSON, SAP button removed, fake AF-id/latency labels replaced with AI_MODEL_FORECAST const; Sidebar build date constant.
Next up: Step 1.4 — date-fns locale formatting.

## 2026-07-18 Step 1.4 — date-fns locale formatting — 340aca9
Gates: lint ✅ build ✅ test ✅ (27)
Notes: formatDate now fnsFormat with de locale; EEEE/EEE bug + MM gap gone. Minor: German short weekday now locale-standard ("Di." style) instead of custom 2-letter.
Next up: Step 1.5 — StrategyModule repairs.

## 2026-07-18 Step 1.5 — StrategyModule repairs — e415db1
Gates: lint ✅ build ✅ test ✅ (27)
Notes: manualInput pattern fixes Generate-Document button; sunburst clamps 2π−ε, skips zero-volume, empty-state legend-only; AI errors translated + logged; dead prop/imports removed; render now pure (angles in useMemo).
Next up: Step 1.6 — Financial correctness.

## 2026-07-18 Step 1.6 — Financial correctness — 4062526
Gates: lint ✅ build ✅ test ✅ (30)
Notes: 4 divergent parseBudget copies deleted → utils/money canonical; compareBudgets numeric sort; KPIs from unfiltered list; MARGIN_THRESHOLDS {risk:10, healthy:25} single source incl. header coloring (was 20); Low-margin filter button added; dead margin SortField/customers prop removed.
Next up: Step 1.7 — App-level consistency.

## 2026-07-18 Step 1.7 — App-level consistency — a614cd4
Gates: lint ✅ build ✅ test ✅ (33)
Notes: utils/uid.ts (crypto.randomUUID) replaced 11 hand-rolled ids incl. utils/planner createId; handleAssignment/AbsenceChange now write to ACTIVE version w/ read-only no-op guard; NaN guards + clamps on number inputs; absenceDuration clamped 1–60; hooks/useToday.ts replaces frozen-at-mount today. Orchestrator fixed 1 missed id in SalesPipeline.
Next up: Step 1.8 — i18n leak sweep + language persistence.

## 2026-07-18 Step 1.8 — i18n leak sweep + language persistence — 79d6f5c
Gates: lint ✅ build ✅ test ✅ (33)
Notes: 71 new keys (411/411 en/de parity); language persisted to localStorage; t() warns on missing keys; bonus fix: sidebar.manage was German in en section. PHASE 1 (P0) COMPLETE.
Next up: Phase 2 — Step 2.1 TypeScript strict mode.

## 2026-07-18 Smoke test after Phase 1
Lightpanda check on fresh preview: app boots, planner renders, CSV Export visible, German locale dates (März/Feb.), translated Latest badge, zero page errors. FALSE ALARM post-mortem: initial blank page was a STALE vite preview process from the previous session holding port 4173 — not a code regression. Bisected 1.1→1.8 before finding it; all builds were fine.
Next up: Step 2.1 — TypeScript strict mode.

## 2026-07-18 Step 2.1 — TypeScript strict mode — d5fd3f0
Gates: lint ✅ build ✅ test ✅ (33)
Notes: strict + noUnusedLocals/Parameters + noUncheckedIndexedAccess ON. 55 unused-code + 35 indexed-access errors fixed across 21 files. Dead: draggingEmpId, handleRemoveAbsence, workingDaysCount, Q1_OUTLOOK mocks, ~20 dead imports. Type predicates replace filter-narrowing; PASTEL fallback everywhere; 4 as-any select casts typed; ProjectFilter discriminated union in planner; forecast.noData key added.
Next up: Step 2.2 — build-time Tailwind (replace CDN). RISKY: requires visual screenshot comparison before commit.

## 2026-07-18 Step 2.2 — Build-time Tailwind — 4bd1f1d
Gates: lint ✅ build ✅ test ✅ (33)
Notes: tailwindcss v4 + @tailwindcss/vite; index.css @theme ports all colors/fonts/animations; @utility for animate-in/fade-in/zoom-in-95/pattern-diagonal-lines-sm/bg-stripes-gray/custom-scrollbar/markdown-prose; base layer ports scrollbars/glass-panel/hover-card/tech-pattern. Badge ring-ring→charcoal-400; PASTEL_VARIANTS.dot replaces class-string surgery. Verified: all used classes present in dist css (shimmer/scale-in unused→tree-shaken, correct); no CDN refs in dist; boot smoke test renders identical DOM text.
Next up: Step 2.3 — Shared UI primitives.

## 2026-07-18 Step 2.3 — Shared UI primitives — 883bc1f
Gates: lint ✅ build ✅ test ✅ (42, +ConfirmDialog/Toast suites; vitest.setup.ts for jest-dom)
Notes: PageHeader (7 adoptions), FormField/TextInput/SelectInput, ProgressBar (aria), StatusBadge, ConfirmDialog (native confirm() eliminated), Toast system (provider + success toasts on save/delete/export/version). Button type=button default. INTERRUPTION: k2p7 quota exhausted mid-run; resumed on k3 which completed. Lesson: keep k2p7 for fresh dispatches, resume falls back to k3.
Next up: Step 2.4 — useCrudForm + Manage* refactor.

## 2026-07-18 Step 2.4 — useCrudForm + Manage* refactor — 9f9f145
Gates: lint ✅ build ✅ test ✅ (49, +useCrudForm suite)
Notes: typed hook (openAdd/openEdit/handleSubmit(buildItem)/requestDelete/validate) adopted by all 3 Manage*; single makeDefaults (drift fixed); i18n validation messages (dates, required) for projects/team/customers; no as-T casts remain in CRUD submits.
Next up: Step 2.5 — Modal & focus accessibility.

## 2026-07-18 Step 2.5 — Modal & focus accessibility — c7ecef4
Gates: lint ✅ build ✅ test ✅ (57, +8 Modal a11y tests)
Notes: Modal full a11y (Escape, backdrop, trap, restore, aria); chat conditional render (no focus into hidden UI) + close-confirm + real restore button; sidebar popover aria/Escape; Badge→button when clickable; planner aria-labels + sr-only select label; hooks/useFocusTrap.ts.
Next up: Step 2.6 — business-math test coverage (utils/forecast extraction). PHASE 2 finale.

## 2026-07-18 Step 2.6 — Business-math test coverage — 4346956
Gates: lint ✅ build ✅ test ✅ (74, +17 forecast tests)
Notes: utils/forecast.ts (parseQuarterName/computeQuarterCapacity/computeMonthlyBreakdown/runMonteCarloSimulation w/ injectable rng). Fixes: rawAvailable exposed (red negatives live), histogram raw counts, probability 0/100 honored (was || 50). PHASE 2 (P1) COMPLETE.
Next up: Phase 3 — Step 3.1 ResourcePlanner render performance.

## 2026-07-18 Step 3.1 — ResourcePlanner performance — a27ecee
Gates: lint ✅ build ✅ test ✅ (77, +PlannerCell suite)
Notes: Map indexes (empId|date) for assignments+absences → O(1) cell lookups; PlannerCell/PlannerRow React.memo; DayEditModal extracted (669 LOC) — modal typing no longer re-renders grid; ref-based today-jump replaces setTimeout+getElementById; gridViewModel useMemo. ResourcePlanner.tsx 1340→987 LOC. Retry note: first k2p7 dispatch cold-failed (no output), second succeeded.
Next up: Step 3.2 — QuarterlyForecast render performance.

## 2026-07-18 Step 3.2 — QuarterlyForecast performance — 07a536a
Gates: lint ✅ build ✅ test ✅ (79)
Notes: CommitNumberInput (draft/blur-commit/Escape-revert) for all inline number inputs — keystrokes no longer re-render the route; ForecastQuarterCard memoized w/ useMemo'd capacity; SimResult drops 2000-element iterations array (percentiles computed inside, +expected mean).
Next up: Step 3.3 — Bundle splitting (React.lazy routes).

## 2026-07-18 Step 3.3 — Bundle splitting — 7eb5e31
Gates: lint ✅ build ✅ test ✅ (79)
Notes: 8 lazy routes + single Suspense (AsciiSpinner + common.loading); rolldown output.codeSplitting groups vendor-react/vendor-ai/vendor-date (orchestrator renamed deprecated advancedChunks→codeSplitting). Main chunk 909.51→97.48 kB; no size warning. Verified in headless CHROME (--dump-dom): planner/strategy/forecast all render incl. lazy chunks. IMPORTANT: Lightpanda CANNOT load nested module graphs (static cross-chunk imports + dynamic import() fail) — all future smoke tests must use headless Chrome. PHASE 3 (P2) COMPLETE.
Next up: Phase 4 (P3) — decision-gated epics (Gate A backend, Gate B auth, Gate C charts).

## 2026-07-18 Step 4.0 — Persistence seam (backend prep) — 33d6a83
Gates: lint ✅ build ✅ test ✅ (84, +5 persistence tests)
Notes: services/persistence/ — PersistenceProvider interface + localStorageProvider (identical keys/behavior) + README with Rust/SQLite/Protobuf/HTTP3-WebTransport migration path. App.tsx uses the seam. Environment lesson: vitest jsdom under Node 26 is flaky (experimental built-in localStorage interferes) → persistence suite stubs localStorage hermetically; CI on Node 24 unaffected.
Owner decision recorded in PLAN.md: standalone gh-pages app; future split = Rust single worker + SQLite + protobuf + HTTP3 (WebTransport), separate design run. Phase 4 reduced to standalone epics 4.3/4.4/4.5/4.6.
BLOCKER: `git push` fails from this session (no GitHub credentials: HTTPS remote, osxkeychain empty, no gh CLI, no SSH key). main is merged locally (ff) and ready for the user to push.
Next up: user pushes main → CI deploys gh-pages. Optional standalone epics 4.3–4.6 on request.

## 2026-07-18 Release v1.3.1 — $(git rev-parse --short HEAD)
Gates: lint ✅ build ✅ test ✅ (84)
Notes: package.json 0.0.0→1.3.1; __APP_VERSION__ injected via vite define (single source); Sidebar version button + changelog build line dynamic; new v1.3.1 changelog section (en+de, 11/11 key parity): data safety, overloads, exports, performance, quality. Verified rendering via headless Chrome dump-dom.
Next up: epic 4.3 — AI service layer + streaming.
