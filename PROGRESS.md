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
