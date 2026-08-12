# Task: Replace Custom Data Layer with TanStack Query

Status: **NOT STARTED — separate effort, sequenced AFTER shadcn migration**
Owner: web (ibs-qfc-kitchen)
Target: `web/src/api/**`, component call sites of `useLiveStore`/`useUsers`/`useAdmin`

## Objective

Replace the hand-rolled server-state layer (`liveStore.tsx` context store +
`useUsers`/`useAdmin` hooks) with TanStack Query v5, keeping the real-time
event-stream sync. Goal: delete bespoke state plumbing (~1.2k lines incl.
tests) in favor of library-idiomatic cache semantics — **without changing
observable behavior**. Frontend-only: no TanStack server packages; the
Rust/Connect backend stays as-is.

## Current inventory (measured 2026-08-12)

| File | Lines | Role |
|---|---|---|
| `web/src/api/liveStore.tsx` | 860 | Provider + context: snapshot load of 8 collections, `EventService.Watch` stream with seq high-water mark, backoff/reconnect, DataLoss full reload, hydration-race merge, optimistic upserts |
| `web/src/api/liveStore.test.tsx` | 595 | Behavior suite for the above — **used as the parity oracle** |
| `web/src/api/useUsers.ts` | 76 | Load/mutation hooks for admin user management (no push channel) |
| `web/src/api/useAdmin.ts` | 227 | `SystemStatus` polling (15 s), app-settings load/update |
| `web/src/api/adapters.ts` | 924 | proto→domain mapping — **unchanged**, stays the adapter boundary |
| `web/src/api/clients.ts`, `transport.ts`, `delta.ts` | ~120 | Connect clients / transport / delta helper — unchanged |

## Design

- One `QueryClient` in `src/index.tsx` (alongside `SettingsProvider`).
- Entity collections become `useQuery` keys (`['employees']`, `['projects']`,
  …, `['versions']`), loaded via the existing RPC clients through
  `adapters.ts`.
- **Realtime sync**: a single watch loop (the existing `watchLoop` logic:
  `lastSeq` ref, backoff, `Code.DataLoss` → full reload) lives in one
  provider; each applied `ChangeEvent` calls `queryClient.setQueryData` for
  the affected collection key instead of `setData(prev => applyChangeEvent(...))`.
  `applyChangeEvent` keeps its per-entity merge/delete semantics — it is
  reused, not rewritten.
- Optimistic writes (`upsertEmployee`, …) become mutations that call
  `queryClient.setQueryData` on success (server returns canonical entity,
  like today) or `invalidateQueries` where no canonical response exists.
- `useSystemStatus(pollMs=15000)` → `useQuery({ ..., refetchInterval: pollMs })`.
- `useUsers` admin flow → `useQuery` + `useMutation` (list is NOT on the
  watch stream — never join it to live entities).
- Consumers (`App.tsx` gates, `ResourcePlanner`, all components reading
  `useLiveStore`) switch to `queryClient`-backed hooks with the same
  field names (employees, projects, …) so per-component diffs stay small.
- `hydrateVersion` / `knownFullVersionIdsRef` / `PendingHydration` merge
  logic moves 1:1 into the watch provider or a dedicated hook — do not
  "simplify" it during the port (it exists to close a real race).

## Acceptance criteria (parity)

- `liveStore.test.tsx` scenarios pass against the Query implementation
  (adapt tests only where the seam is the cache, not behavior).
- Status semantics identical: `loading | ready | error | reconnecting` for
  the store gate; load errors surface via toast exactly as today
  (`LiveStoreGate`).
- Watch reconnect + `DataLoss` reload behavior proven by the existing tests
  plus one integration case with a mocked `eventClient` that drops the
  stream.
- `pnpm -C web build`, `pnpm -C web lint`, `pnpm -C web test` green.
- No server-side TanStack packages added. `adapters.ts`/`transport.ts`
  untouched except for import paths.

## Risks

- **Hydration race / seq watermark logic is subtle and tested; a port must
  reuse `applyChangeEvent` + the pending-hydration merge verbatim.** Do not
  rewrite event bookkeeping while switching cache layers.
- Broad blast radius: nearly every component consumes the store. Sequence
  AFTER the shadcn migration so the component layer is not churning twice.
- Query v5 `setQueryData` updates must preserve the collections' existing
  selector contracts (e.g. embedded `Project[]` inside `QuarterData`).

## Effort estimate

3–5 days including parity test suite. Highest-risk step of the UI roadmap;
do not start before shadcn migration is merged and released.
