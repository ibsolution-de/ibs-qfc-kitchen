# Task: Migrate Charts from Recharts to TanStack Charts

Status: **NOT STARTED — gated on library maturity** (see Risk section)
Owner: web (ibs-qfc-kitchen)
Target: `web/src/components/**`

## Objective

Replace the four Recharts-based visualizations with TanStack Charts
(`@tanstack/charts`), reducing bundle size (~110 KiB min+gz per chart page)
and unifying on the TanStack grammar (marks/scales/guides). Applies to the
React SPA only — the Rust/Connect backend is untouched. No TanStack
server-side packages are involved.

## Current inventory (measured 2026-08-12)

| Component | File | Recharts API used | Port difficulty |
|---|---|---|---|
| Financial overview | `web/src/components/FinancialOverview.tsx` | grouped `BarChart`, `Legend`, `Tooltip` | Easy (pilot) |
| Quarterly forecast | `web/src/components/QuarterlyForecast.tsx` | `BarChart` + per-cell `Cell` colors + `ReferenceLine` | Medium (color channel + rule mark) |
| Strategy module | `web/src/components/StrategyModule.tsx` | `PieChart` + `Cell` + `Legend` | Medium (`@tanstack/charts/polar`: `pie` + `radialArc`) |
| Competency radar | `web/src/components/development/CompetencyRadar.tsx` | `RadarChart`, 2 `Radar` series, `PolarGrid/AngleAxis/RadiusAxis` | High (needs `fold`/`normalize` transforms, `d3-shape` curve; sr-only table fallback must stay) |

## Library state (verified 2026-08-12)

- Latest published version: **0.11.1, pre-alpha — API may change between
  releases**. Docs track unreleased `main`.
- Official measured bundle: 37–43 KiB min+gz vs Recharts 153–168 KiB (+
  ~95–110 KiB externalized React). Tooltip/legend/axes/responsive resize are
  built in; SVG default, Canvas opt-in; keyboard focus default.
- Polar/radar exists at `@tanstack/charts/polar` (`pie`, `polar`,
  `radialArc`, `radialArea`, `radialLine`, `angleGrid`, `radialGrid`).
- Recharts parity corpus: 27 Recharts reference pairs in the conformance
  suite — the migration path is actively tested upstream.
- Reference lines → rule marks; per-cell colors → `color` channel.

## Steps

1. **Pilot (gate decision): port `FinancialOverview.tsx` only**, on a
   branch. Keep recharts mounted for the other three components.
   - Add `@tanstack/charts` (plus `d3-shape` only where needed).
   - Rebuild the grouped bar chart with `defineChart`, `barY` mark,
     `scaleBand`/`scaleLinear`, built-in legend + tooltip extension.
   - Compare: bundle delta vs `main` (`pnpm -C web build` + size), visual
     parity in dev, keyboard focus, tooltip accuracy, i18n strings
     (`useLanguage`) still wired.
2. **Decision point**: present pilot diff + bundle numbers. Full port only
   when a stable release (>= 1.0, API-frozen) exists **or** the team
   explicitly accepts pre-alpha churn on a deployed app (ArgoCD, v1.4.0).
3. Full port, in order: QuarterlyForecast, StrategyModule, CompetencyRadar.
   - Radar: normalize ratings (0..5) explicitly; keep the `sr-only` data
     table; `curveLinearClosed` from `d3-shape`.
4. Remove `recharts` from `web/package.json`; delete the 4 recharts imports.

## Acceptance criteria

- All four charts render with identical data semantics; unit/histogram axes,
  colors, tooltips verified per component.
- `web/src/components/ui/Badge` pastel palette / `PASTEL_HEX` still used for
  categorical colors (charts + badges stay in sync).
- Chart data transformations (`revenueChartData`, `simResult.histogram`,
  radar `radarData`) stay in the components — do not leak into the data
  layer.
- `pnpm -C web build`, `pnpm -C web lint`, `pnpm -C web test` green.
- No TanStack server-side packages added.

## Risks

- **Pre-alpha API**: breaking changes between 0.x releases; docs may not
  match the pinned version. Mitigation: pilot first, pin exact version.
- Radar/pie require more transforms (fold/normalize, d3-shape) than
  Recharts — a local complexity increase for those two components.
- Animation behavior differs (`ResponsiveContainer` + `animate` vs TanStack
  scene animation); confirm no visual regression on load.

## Effort estimate

Pilot: 0.5–1 day. Full port: 3–5 days incl. visual QA. Deferred until the
maturity gate passes.
