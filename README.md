# IBs QFC Kitchen

A modern macOS-style resource planning and quarterly forecasting tool for project managers.

## Structure

```
ibs-qfc-kitchen/
├── package.json          # root orchestrator, scripts delegate to web/
├── pnpm-workspace.yaml   # packages: [web]
├── web/                  # React 19 + TS + Vite 8 + Tailwind 4 SPA
├── api/                  # Rust backend: axum + Connect RPC (protobuf) + SQLite
└── deploy/               # container image + ArgoCD manifests
```

## Prerequisites

- Node 24
- pnpm 11 (via corepack)
- Rust stable (for `api/`)

## Getting started

```
pnpm install
pnpm dev
```

Optionally, put `GEMINI_API_KEY=<key>` in `web/.env.local` — only the AI features need it.

## Commands

Run from the repo root (all delegate into `web/`, except the `api:*` ones):

| Command | Description |
|---|---|
| `pnpm dev` | Run the web app (:3000) |
| `pnpm build` | Build the web app |
| `pnpm lint` | Type-check the web app (`tsc --noEmit`) |
| `pnpm test` | Run web tests |
| `pnpm test:watch` | Run web tests in watch mode |
| `pnpm preview` | Preview the built web app |
| `pnpm api:dev` | Run the Rust backend |
| `pnpm api:lint` | Lint the Rust backend (`cargo clippy`) |
| `pnpm api:test` | Run Rust backend tests |

All scripts also work from inside `web/` via `pnpm <script>`.

## Deployment

See `deploy/` for the web container image (`deploy/images/web/`) and the ArgoCD manifests (`deploy/argocd/`).

## Status

The frontend talks to the Rust backend over Connect RPC; there is no local-only persistence path anymore. See `api/README.md` for the API's stack, RPCs, storage model, and live-sync contract.
