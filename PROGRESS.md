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
