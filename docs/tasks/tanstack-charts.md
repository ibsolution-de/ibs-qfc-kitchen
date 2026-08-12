# Task: Migrate Charts from Recharts to TanStack Charts

Status: **PARTIALLY DONE — 2 of 4 ported on 2026-08-12; 2 intentionally kept on
recharts** (see "Port decisions" below)
Owner: web (ibs-qfc-kitchen)
Target: `web/src/components/**`

## Objective

Replace Recharts-based visualizations with TanStack Charts
(`@tanstack/charts`), reducing per-chart-page bundle size and unifying on the
TanStack grammar (marks/scales/guides). Frontend-only — the Rust/Connect
backend is untouched.

## Result (2026-08-12)

| Component | Status | Notes |
|---|---|---|
| Financial overview | **Ported** | `barY` + `stack({order})`, long-form rows, `colorLegend`, €k ticks, tooltip |
| Quarterly forecast | **Ported** | `rect` histogram (x1/x2 intervals on linear x), per-bin `color` zones, dashed `ruleX` capacity line |
| Strategy module | **Kept on recharts** | Two-ring burst (metrics + per-metric projects) with per-slice labels/`%`-threshold, legend, % tooltips — polar port raises complexity |
| Competency radar | **Kept on recharts** | Radar needs fold/normalize, radius-axis tick labels are not supported by polar guides; sr-only table is the a11y story |

`recharts` dependency stays in `web/package.json` (StrategyModule +
CompetencyRadar). Bundle effect: migrated pages load the shared TanStack
`Chart` chunk (≈29.7 kB gz) instead of the recharts chunk (≈91 kB gz).

## Port decisions (architect)

- **FinancialOverview**: stacked bars per client over 4 quarters. Long-form
  rows `{quarter, client, revenue}`; `layout: stack({ order: clients })`;
  per-client colors from `PASTEL_HEX` via `getClientHexColor`; bottom
  `colorLegend`; y-axis `ticks.format` `€Nk`.
- **QuarterlyForecast**: equal-width histogram bins → `rect` with
  `x1/x2/y1(() => 0)/y2` interval channels on a linear x scale (bins carry
  lower+upper bound); per-bin color via `color` channel zones
  `safe`/`overload` (`#3b82f6`/`#ef4444`), no legend (HTML chips already
  exist); dashed `ruleX([baseCapacity])`; x ticks `${v}d`.
- **Kapcsolódó API facts (verified against installed 0.11.0)**:
  - Channels accept a field name or an accessor fn — NOT raw literals
    (`y1: 0` fails; `y1: () => 0` per the distributions example).
  - `fill` on `rect`/`barY` is a plain string — per-datum color goes through
    the `color` channel + definition-level `color.domain/range`.
  - `ruleX(source, {stroke, strokeDasharray, strokeWidth})` — value comes
    from the source datum; no label support (surrounding UI carries the
    capacity text).
  - Charts docs are version-matched inside the package:
    `node_modules/@tanstack/charts/docs/` (main entry exports, mark options,
    React quick-start, examples).

## Remaining work

- Revisit StrategyModule + CompetencyRadar when polar gains radius-axis tick
  labels / labeled nested rings without custom marks, or when the team
  explicitly accepts the UX deltas.
- Then remove `recharts` from `web/package.json`.

## Verification

- `pnpm -C web lint` (tsc strict), `pnpm -C web test` (227 tests incl.
  `FinancialOverview.chart.test.tsx` mount smoke: SVG renders, sr-only table
  and aria-label preserved), `pnpm -C web build` — all green.
- Full-app visual pass remains blocked by the empty dev-DB baseline (no demo
  seed); chart mounting proven via the jsdom mount test.
