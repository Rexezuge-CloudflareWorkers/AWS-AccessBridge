# AGENTS.md

Guidance for agents working in AWS-AccessBridge. `CLAUDE.md` is a symbolic link to this file. This is the global index — follow the links to scoped sub-guides before working in an area.

## Overview

AWS-AccessBridge is a Cloudflare Worker API + Vite React SPA in a pnpm workspace (`@aws-access-bridge/monorepo`, `packageManager: pnpm@11.2.2`).

- **Core**: Cloudflare Zero Trust on `/user/*` (JWT `cf-access-jwt-assertion`); programmatic access under `/api/*` via Bearer PATs or HMAC-signed internal self-calls; users assume AWS roles across accounts and mint temporary Console URLs. See `apps/api/AGENTS.md`.
- **Credentials**: encrypted IAM credentials with multi-hop assumption chains (up to `PRINCIPAL_TRUST_CHAIN_LIMIT`), KV credential caching. See `docs/agents/features/credential-chains/AGENTS.md`.
- **Analytics**: Cost Explorer collection with spend alerts; EC2/S3/Lambda/RDS/DynamoDB inventory. See `docs/agents/features/cost-analytics/AGENTS.md` and `docs/agents/features/resource-inventory/AGENTS.md`.
- **Teams**: multi-tenant team workspaces scoping AWS accounts. See `docs/agents/features/teams/AGENTS.md`.
- **Assume-role flows**: browser + programmatic + federate fan-out. See `docs/agents/features/assume-role/AGENTS.md`.

## Cloudflare Documentation

**STOP.** APIs, limits, and behavior change frequently. Before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or Agents SDK task, retrieve current official docs.

- Workers: https://developers.cloudflare.com/workers/
- Cloudflare MCP: https://docs.mcp.cloudflare.com/mcp
- Node.js compat: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Worker errors: https://developers.cloudflare.com/workers/observability/errors/
- Limits: retrieve each product's `/platform/limits/` page (e.g. `/workers/platform/limits/`)
- Product refs: `/workers/`, `/kv/`, `/r2/`, `/d1/`, `/durable-objects/`, `/queues/`, `/vectorize/`, `/workers-ai/`, `/agents/`
- Error 1102 = CPU/memory exceeded; see `/workers/platform/limits/`.
- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

## Commands

Plain `pnpm` is canonical. No `source ~/.customrc`, no `volta run` prefix. Type-aware ESLint and Vitest need heap headroom on small machines: prefix with `NODE_OPTIONS="--max-old-space-size=6144"`.

```bash
pnpm install
pnpm -r typecheck && pnpm run lint && pnpm run test:coverage && pnpm run test:integration
pnpm --filter @aws-access-bridge/web build   # only web has a build script
pnpm --filter @aws-access-bridge/web dev     # vite dev server
pnpm run typegen   # after changing wrangler bindings
pnpm exec wrangler dev
pnpm exec wrangler deploy
```

## Import Direction

```
Layer 0: shared, backend-errors          — zero @aws-access-bridge/* deps
Layer 1: backend-runtime                 → layer 0 only
Layer 2: backend-data                    → layer 0 only
Layer 3: backend-services                → layers 0–2 (not apps)
(no Layer 4 by design)
Layer 5: apps/background                 → layers 0–3
         apps/api                        → layers 0–3 + background (NOT aws4fetch directly)
```

Enforced by ESLint `no-restricted-imports` in `eslint.config.mjs` (Layer 5 blocks `apps/api → aws4fetch`; route AWS SDK usage through `@aws-access-bridge/backend-services`).

## Index

| Area                                            | Guide                                               |
| ----------------------------------------------- | --------------------------------------------------- |
| API worker, auth, routes                        | `apps/api/AGENTS.md`                                |
| Background worker, cron phases, task visibility | `apps/background/AGENTS.md`                         |
| Web SPA, frontend i18n, UI text conventions     | `apps/web/AGENTS.md`                                |
| D1/DAO layer, KV cache, retention pruning       | `packages/backend-data/AGENTS.md`                   |
| Business logic, service domain map              | `packages/backend-services/AGENTS.md`               |
| Bindings, wrangler, env vars                    | `docs/agents/runtime/AGENTS.md`                     |
| Tests, thresholds, mock patterns                | `docs/agents/testing/AGENTS.md`                     |
| Assume-role flows                               | `docs/agents/features/assume-role/AGENTS.md`        |
| Credential chains                               | `docs/agents/features/credential-chains/AGENTS.md`  |
| Cost analytics + spend alerts                   | `docs/agents/features/cost-analytics/AGENTS.md`     |
| Resource inventory                              | `docs/agents/features/resource-inventory/AGENTS.md` |
| Team workspaces                                 | `docs/agents/features/teams/AGENTS.md`              |

## Keeping AGENTS.md Current

Update the scoped sub-guide (not this index) as part of any change that adds, removes, or renames:

- Routes → `apps/api/AGENTS.md`
- Cron tasks/phases → `apps/background/AGENTS.md`
- Web UI, locales, text conventions → `apps/web/AGENTS.md`
- DAOs, KV cache, pruning → `packages/backend-data/AGENTS.md`
- Services → `packages/backend-services/AGENTS.md` (+ feature file if cross-cutting)
- Env vars, bindings → `docs/agents/runtime/AGENTS.md`
- Tests, thresholds, mocks → `docs/agents/testing/AGENTS.md`
- Top-level features → `docs/agents/features/*/AGENTS.md` + one-line Overview touch-up here

## Commit Policy

Always commit changes after completing work unless explicitly told not to.

## Git Commit Messages

Format: `<TYPE>[optional scope]: <description>`

- Type in UPPERCASE: `FIX`, `FEAT`, `DOCS`, `STYLE`, `REFACTOR`, `TEST`, `BUILD`, `CHORE`, `CI`, `PERF`.
- Scope in lowercase: `FEAT(runtime): Add Scheduled Job State`.
- Description: Title Case words — `DOCS: Latest Agents Context Reflection`.
- When committing from `main`, first create a branch: `type/description` or `type/scope/description` in kebab-case (e.g. `feat/bootstrap/bootstrap-jqanywhere-v0.1-framework`).
- Always include a Markdown body separated from the subject by a blank line.
- Breaking changes: `!` after type/scope, or `BREAKING CHANGE: <description>` footer.

```text
<TYPE>[optional scope]: <description>

[Markdown body]

[optional footers]
```
