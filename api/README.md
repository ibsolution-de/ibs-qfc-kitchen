# api — Rust Backend

## Status

Currently a **skeleton**: a single `GET /healthz` route returning `ok`, built
with **axum** + **tokio**, listening on `0.0.0.0:8080`. No persistence, no
protobuf, no other routes yet.

## Target architecture (future, separate implementation run)

```
┌─────────────┐   protobuf / HTTP3 (WebTransport, QUIC)   ┌──────────────────┐
│  React SPA  │ ◄──────────────────────────────────────► │  Rust worker      │
│  (web/)     │   fallback: HTTP/2 + protobuf over fetch  │  single process   │
└─────────────┘                                          │  SQLite storage   │
                                                         └──────────────────┘
```

- **Backend:** Rust, single worker process, **SQLite** embedded storage.
- **Contract:** **Protobuf** messages defined from the entity shapes in
  `web/src/types.ts` and the aggregate `PersistedState` in
  `web/src/services/persistence/types.ts`
  (Employee, Project, Customer, PlanVersion, Assignment, Absence, QuarterData).
- **Transport:** HTTP/3 over QUIC via **WebTransport** where the browser
  supports it (Chromium), graceful fallback to HTTP/2 + protobuf bodies.

## Migration path when the backend lands

1. Define `.proto` messages mirroring `web/src/types.ts` (field-for-field; the
   domain types were kept JSON-plain deliberately).
2. Implement `PersistenceProvider` as `httpPersistence` (async variant of the
   interface; `save` may batch/debounce).
3. Swap the `persistence` binding in `web/src/services/persistence/localStorageProvider.ts` —
   no component changes.
4. Provide a one-time import of existing localStorage data (the provider's
   `load` output) into SQLite.

## Development

From the repo root:

```
pnpm api:dev    # cargo run --manifest-path api/Cargo.toml
pnpm api:lint   # cargo clippy --manifest-path api/Cargo.toml -- -D warnings
pnpm api:test   # cargo test --manifest-path api/Cargo.toml
```

Equivalent `cargo` commands from inside `api/`:

```
cargo run
cargo clippy -- -D warnings
cargo test
```
