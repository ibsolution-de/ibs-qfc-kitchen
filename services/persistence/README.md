# Persistence Layer — the Backend Seam

The app is currently **standalone**: all state persists to `localStorage` via
`localStorageProvider`. Everything the app persists flows through the
`PersistenceProvider` interface (`types.ts`) — this is the single seam where a
future backend attaches.

## Target architecture (future, separate implementation run)

```
┌─────────────┐   protobuf / HTTP3 (WebTransport, QUIC)   ┌──────────────────┐
│  React SPA  │ ◄──────────────────────────────────────► │  Rust worker      │
│  (this app) │   fallback: HTTP/2 + protobuf over fetch  │  single process   │
└─────────────┘                                          │  SQLite storage   │
                                                         └──────────────────┘
```

- **Backend:** Rust, single worker process, **SQLite** embedded storage.
- **Contract:** **Protobuf** messages defined from the entity shapes in
  `types.ts` and the aggregate `PersistedState` in `./types.ts`
  (Employee, Project, Customer, PlanVersion, Assignment, Absence, QuarterData).
- **Transport:** HTTP/3 over QUIC via **WebTransport** where the browser
  supports it (Chromium), graceful fallback to HTTP/2 + protobuf bodies.

## Migration path when the backend lands

1. Define `.proto` messages mirroring `types.ts` (field-for-field; the domain
   types were kept JSON-plain deliberately).
2. Implement `PersistenceProvider` as `httpPersistence` (async variant of the
   interface; `save` may batch/debounce).
3. Swap the `persistence` binding in `localStorageProvider.ts` — no component
   changes.
4. Provide a one-time import of existing localStorage data (the provider's
   `load` output) into SQLite.
