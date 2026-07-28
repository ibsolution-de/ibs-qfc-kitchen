# ibs-qfc-kitchen — Project Rules

Monorepo: `web/` (React 19 + TypeScript + Vite 8 + Tailwind 4 SPA, tests with
Vitest), `api/` (Rust backend, currently a skeleton), `deploy/` (container
image + ArgoCD manifests).
Root scripts delegate into `web/`: `pnpm dev`, `pnpm build`, `pnpm lint`
(`tsc --noEmit`), `pnpm test`. Backend scripts: `pnpm api:dev`, `pnpm api:lint`,
`pnpm api:test`.

## Structure

```
ibs-qfc-kitchen/
├── web/      # React 19 + TS + Vite 8 + Tailwind 4 SPA
├── api/      # Rust backend (axum + tokio) — skeleton
└── deploy/   # container image + ArgoCD manifests
```

## Delegation Rule (mandatory)

Two roles. Main thread (Opus 5) orchestrates and decides. Subagents (Sonnet 5) do the legwork.

### Main thread keeps (never delegate)

- Orchestration: split work, order steps, spawn/coordinate agents, merge results.
- Overview: hold the mental model of the change, track what is done and what is left.
- Decisions: pick approach, accept trade-offs, resolve conflicting agent findings.
- Review: judge subagent output and diffs before it counts as done.
- Planning and solution evaluation *together with the user*: ask questions, present options, agree scope.
- Anything irreversible or outward-facing: git commit/push, deploy, deletes, external calls.
- Talking to the user. Subagent reports are input, not answers — relay the conclusion, not the dump.

### Delegate to subagents (Sonnet 5) — default for all of this

| Work | Agent |
|------|-------|
| Find code, trace call paths, map directories, check files, extract data from files | `researcher` |
| Web research, docs lookup, browser automation and screenshots | `web-researcher` |
| Planning legwork: gather constraints, list affected files, draft options with trade-offs | `plan-researcher` |
| Write code against an explicit spec, refactor, apply mechanical changes | `implementer` |
| Write and run tests, `pnpm test`, `pnpm lint`, reproduce bugs | `tester` |

Rules:

1. If work needs no judgement call — only reading, searching, fetching, writing-to-spec, or running commands — it goes to a subagent. Do not do it inline.
2. Every project agent above is pinned `model: sonnet`. Do not override to opus.
3. Built-in `Explore`, `Plan`, and `general-purpose` agents do **not** read this file, so when using them always pass `model: "sonnet"` in the Agent call.
4. Independent subagent work goes out in one message, multiple Agent calls, so it runs concurrently.
5. Give a subagent a spec, not a goal it must interpret: name the files, the expected output shape, and the acceptance check. Open-ended judgement stays in the main thread.
6. Subagent results are unverified. Read the diff or spot-check the claim before reporting it done.
7. Continue an existing agent with `SendMessage` instead of respawning a fresh one for the same context.

## Tooling (this machine)

`rg` not grep, `fd` not find, `xh` not curl, `dust` not du, `mgrep` for semantic search, `agent-browser` for browsing. Containers: Apple `container`, no Docker.
