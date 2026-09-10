# AGENTS.md

This file provides guidance to LLM agents when working with code in this repository.

## Project Overview

AWS AccessBridge is a Cloudflare Worker that provides a web-based AWS role assumption bridge. It lets users assume AWS roles across multiple accounts and generate temporary AWS Console URLs. Authentication is handled by Cloudflare Zero Trust.

**Stack:** Hono + Chanfana (OpenAPI) backend on Cloudflare Workers, Durable Objects for cron task execution, React 19 + Tailwind CSS v4 frontend (Vite SPA), Cloudflare D1 database (26 migrations), Cloudflare KV for credential caching, Cloudflare Secrets Store for encryption keys and internal HMAC secret. The API Worker and Pages-style web deployment each have their own Wrangler template (`apps/api/wrangler.template.jsonc`, `apps/web/wrangler.template.jsonc`).

## Cloudflare Documentation Policy

Cloudflare Workers APIs, platform limits, and product behavior change over time. Before doing any task that depends on Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or the Agents SDK, retrieve the current official Cloudflare documentation instead of relying on memory.

Official references:

- Workers docs: https://developers.cloudflare.com/workers/
- Cloudflare docs MCP: https://docs.mcp.cloudflare.com/mcp
- Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Workers errors: https://developers.cloudflare.com/workers/observability/errors/
- Durable Objects best practices: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows best practices, if Workflows are introduced: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

For limits and quotas, retrieve the relevant product `/platform/limits/` page, for example `https://developers.cloudflare.com/workers/platform/limits/`. For product APIs and limits, use the official docs under `/kv/`, `/r2/`, `/d1/`, `/durable-objects/`, `/queues/`, `/vectorize/`, `/workers-ai/`, and `/agents/` as applicable. For Cloudflare Error 1102 (CPU or memory exceeded), check the current Workers platform limits page.

## Commands

```bash
# Install
pnpm install              # Installs all workspace dependencies

# Development
pnpm dev                 # Vite dev server for frontend SPA
pnpm exec wrangler dev -c apps/api/wrangler.template.jsonc   # Run API worker locally from the template config

# Build
pnpm build               # Build all packages (web then api)
pnpm --filter @aws-access-bridge/web build # Build frontend only

# Deploy
pnpm deploy              # build + `wrangler deploy --dry-run` + `wrangler deploy`

# Code Quality
pnpm prettier            # Format all code
pnpm lint                # Lint + autofix TypeScript
pnpm typecheck           # Type-check all packages
pnpm test                # Run vitest tests

# Cloudflare
pnpm exec wrangler dev          # Local Cloudflare dev server
pnpm exec wrangler deploy       # Deploy to Cloudflare
pnpm exec wrangler deploy --dry-run  # Dry-run deploy
pnpm exec wrangler types --env-interface CloudflareEnv ./apps/api/cloudflare-env.d.ts  # Regenerate Worker binding types

# Official Cloudflare command equivalents when not using pnpm
npx wrangler dev
npx wrangler deploy
npx wrangler types

# Database
pnpm exec wrangler d1 migrations apply --remote aws-access-bridge-db    # Apply migrations to remote D1
pnpm exec wrangler d1 migrations apply --local aws-access-bridge-db     # Apply migrations locally
```

Run `wrangler types` after changing bindings in the Wrangler config. The root `cf-typegen` script currently writes to `./cloudflare-env.d.ts`; the checked-in API binding type file is `apps/api/cloudflare-env.d.ts`, so prefer the explicit command above unless the script is updated.

## Mono-repo Structure

```
aws-access-bridge/
├── apps/
│   ├── web/                    # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── SpaApp.tsx      # SPA entry point
│   │   │   ├── main.tsx
│   │   │   └── components/    # React components
│   │   ├── dist/               # Build output, used by Worker assets and Pages output
│   │   └── package.json
│   └── api/                    # Cloudflare Worker (backend)
│       ├── src/
│       │   ├── index.ts        # Worker entry point
│       │   ├── workers/         # AccessBridgeWorker, CronTasksWorker
│       │   ├── endpoints/       # API route handlers
│       │   ├── dao/             # Data access objects
│       │   ├── model/           # Internal models
│       │   ├── middleware/      # HMAC, auth, audit
│       │   ├── scheduled/       # Cron task handlers
│       │   ├── schema/          # Zod schemas (re-exports from shared)
│       │   └── generated/      # SPA shell (auto-generated at build, stubbed after install)
│       └── package.json
├── packages/
│   └── shared/                 # Shared types, schemas, utilities
│       ├── src/
│       │   ├── schema/         # Zod input/output/common schemas
│       │   ├── types.ts
│       │   └── utils.ts
│       └── package.json
├── migrations/                  # D1 migrations
├── functions/                   # Cloudflare Pages Function proxy to the API Worker
├── test/                       # Vitest tests
└── scripts/                    # Build/deploy scripts
```

## Architecture

### Entry point and request flow

`apps/api/src/index.ts` exports a default `AccessBridgeWorker` instance and the `CronTasksWorker` class for the Cloudflare runtime. `AccessBridgeWorker` (`apps/api/src/workers/AccessBridgeWorker.ts`) extends `AbstractEntrypointWorker` (`apps/api/src/base/`) and handles both `fetch` (HTTP) and `scheduled` (cron) events. Cron execution is delegated to the singleton `CronTasksWorker` Durable Object via the `CRON_TASKS` binding, so the AccessBridge worker only performs the trigger handoff.

The frontend SPA is built to `apps/web/dist/` by Vite. The HTML shell is embedded into the Worker bundle at build time via a custom Vite plugin that emits `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`). A catch-all `app.get('*')` handler can serve this HTML for non-API, non-docs, non-asset paths when `SERVE_SPA_FROM_WORKER=true`; the template default is `false`, allowing the separate web/Pages deployment to serve the SPA. Static assets from `apps/web/dist/` are also configured as Worker assets in the API template. A `postinstall` script writes a placeholder stub so type-checks pass before the first build.

Cloudflare Pages uses `functions/[[path]].ts` as a catch-all Pages Function. It proxies requests to the API Worker through the `API_WORKER` service binding and preserves forwarding headers (`X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Uri`, and `X-Forwarded-For`) for origin-aware URL handling.

### Endpoint pattern

User endpoints live under `apps/api/src/endpoints/user/{domain}/{resource}/{METHOD}.ts`; the three programmatic AWS endpoints live under `apps/api/src/endpoints/api/aws/`. Each extends one of two abstract base classes:

- **`IActivityAPIRoute`** (`apps/api/src/endpoints/IActivityAPIRoute.ts`) — Resolves the authenticated user from context (populated by middleware), parses the request body, writes an audit log entry via `waitUntil()`, and delegates to `handleRequest()`. All endpoints inherit from this.
- **`IAdminActivityAPIRoute`** (`apps/api/src/endpoints/IAdminActivityAPIRoute.ts`) — Extends `IActivityAPIRoute`, adds a superadmin check and a demo-mode guard (throws `MethodNotAllowedError` when `DEMO_MODE=true`) before delegating to `handleAdminRequest()`.

Endpoints are re-exported through `apps/api/src/endpoints/index.ts` (cast to `any` for Chanfana compatibility) and registered as Hono routes in `AccessBridgeWorker` (`registerUserRoutes` / `registerApiRoutes`).

### Auth and routing (user/api split)

Modeled on Mail-Otter: Cloudflare Access protects the human surface only.

- **`/user/*` — Cloudflare Access only** (`MiddlewareHandlers.userAuthentication()` → `EmailValidationUtil` JWT verify; `DEMO_MODE=true` bypasses). Bearer PATs are rejected here; internal `X-Internal-*` self-calls are rejected here. Covers all SPA calls: `GET /user/me`, assumables/search, favorites, hidden roles, tokens management (`GET/POST/DELETE /user/tokens`), `POST /user/aws/assume-role`, `POST /user/aws/console`, `GET /user/aws/federate`, costs (`GET /user/costs/summary|account|trends`), resources (`GET /user/resources[/summary]`), and everything under `/user/admin/*` (credentials, access, nicknames, role config, audit-logs, costs/alerts, collection/config, teams, maintenance).
- **`/api/*` — Bearer PAT or HMAC-signed internal calls only** (`MiddlewareHandlers.apiAuthentication()` → `TokenAuthUtil.authenticateWithPAT`; `X-Internal-*`/self-hostname requests resolve the user from `X-Internal-User-Email` after the global `hmacValidation()` middleware verifies the signature). Access JWTs are rejected here. Only three routes: `POST /api/aws/assume-role`, `POST /api/aws/console`, `GET /api/aws/federate` (the `/user/aws/federate` flow fans out to the `/api/aws/*` pair internally via SELF + HMAC).
- **Cloudflare Access policy** must cover `/user/*` plus the SPA page routes (`/`, `/costs`, `/resources`, `/admin/*`) and must **exclude** `/api/*`, `/docs`, `/openapi.json`.
- **`/docs`, `/openapi.json`** — Chanfana generated, public.

### API endpoints (51 total routes registered)

Counts reflect routes registered in `AccessBridgeWorker` — the three AWS operations are registered twice (once per surface, sharing the same Route classes); admin-adjacent operations (costs alerts, data collection config, teams, maintenance) live under the `/user/admin/*` prefix.

**User — AWS Operations (3):** `POST /user/aws/assume-role`, `POST /user/aws/console`, `GET /user/aws/federate`
**User Operations (10):** assumables list/search, me, favorites (POST/DELETE), hidden roles (POST/DELETE), access tokens (`GET/POST/DELETE /user/tokens`)
**Admin — Credentials & Access (7):** credentials POST, credentials/relationship (POST/DELETE), credentials/validate POST, credentials/test-chain POST, access grant/revoke (POST/DELETE)
**Admin — Account & Role Config (5):** account/nickname (PUT/DELETE), role/config (PUT/DELETE), account/roles POST (IAM role discovery)
**Admin — Audit (1):** `GET /user/admin/audit-logs`
**Admin — Cost & Data Collection (4):** costs/alerts (POST/DELETE), collection/config (POST/DELETE)
**Admin — Teams (11):** team CRUD, team name PUT, team member add/remove/list, team member role PUT, team account add/remove/list
**Admin — Maintenance (1):** `POST /user/admin/maintenance/cleanup-orphaned` (admin-triggered orphan purge across satellite tables)
**Cost Operations (3):** `GET /user/costs/summary`, `GET /user/costs/account`, `GET /user/costs/trends`
**Resource Operations (2):** `GET /user/resources` (with filters), `GET /user/resources/summary`
**Programmatic API — AWS Operations (3):** `POST /api/aws/assume-role`, `POST /api/aws/console`, `GET /api/aws/federate` (Bearer PAT or HMAC internal; same handlers as the `/user/aws/*` trio)

### Internal service-to-service calls

The worker calls itself via the `SELF` service binding. These internal requests target `/api/aws/*` and are signed with HMAC-SHA256 using the `INTERNAL_HMAC_SECRET` secret (`packages/backend-core/src/utils/helpers/InternalRequestHelper.ts`, `apps/api/src/middleware/HMACHandler.ts`). Requests with `X-Internal-*` headers or originating from the self-worker hostname are validated by the HMAC middleware; external requests pass through without HMAC checks.

### Credential chain and caching

Credentials are stored encrypted (AES-GCM, key from `AES_ENCRYPTION_KEY_SECRET`) in D1. The system supports multi-hop role assumption chains: a base IAM user credential assumes an intermediate role, which then assumes the target role (up to `PRINCIPAL_TRUST_CHAIN_LIMIT` hops). `CredentialCacheRefreshTask` (`apps/api/src/scheduled/`) runs through `CronTasksWorker` on a cron schedule (every 10 minutes) to pre-cache assumed credentials in KV.

### Audit logging

Every API request is automatically logged via the `IActivityAPIRoute` base class. The `handle()` method has a `finally` block that uses `c.executionCtx.waitUntil()` to write audit logs asynchronously. A path-to-action map in `packages/backend-core/src/constants/AuditActions.ts` translates HTTP method+path to semantic action names (e.g., `ASSUME_ROLE`, `GRANT_ACCESS`). The `AuditLogCleanupTask` deletes entries older than `AUDIT_LOG_RETENTION_DAYS` (default 90).

### Cost analytics

Background collection via `CostDataCollectionTask` (scheduled). Uses `AwsApiUtil.getCostAndUsage()` to call AWS Cost Explorer API via `aws4fetch`. Collects 30 days of daily cost data, 3 accounts per invocation. Data stored in D1 `cost_data` table. Admins must enable collection per-credential via the `data_collection_config` table; `spend_alerts` stores configurable cost threshold alerts.

### Resource inventory

Background collection via `ResourceInventoryCollectionTask` (scheduled). Calls EC2 DescribeInstances, S3 ListBuckets, Lambda ListFunctions, and RDS DescribeDBInstances. 2 accounts per invocation. Data stored in D1 `resource_inventory` table. Stale resources are cleaned up after each collection cycle.

### Team workspaces

Multi-tenant team boundaries. Tables: `teams`, `team_members` (role: admin/member), `team_accounts`. A default team (UUID `00000000-0000-0000-0000-000000000000`) is seeded with all existing data (migration 0026). Three authorization tiers: global superadmin, team admin, team member. Teams scope at the account level via `team_accounts`, not at the credentials level (credentials are shared resources).

### Scheduled tasks (4)

1. **CredentialCacheRefreshTask** — Refreshes cached assumed credentials in KV
2. **AuditLogCleanupTask** — Deletes old audit log entries past retention period
3. **CostDataCollectionTask** — Collects AWS Cost Explorer data for enabled accounts
4. **ResourceInventoryCollectionTask** — Collects EC2/S3/Lambda/RDS inventory for enabled accounts

All run sequentially on the same cron trigger (`*/10 * * * *`) inside the singleton `CronTasksWorker` Durable Object. `AccessBridgeWorker.handleScheduled()` only invokes that Durable Object through the `CRON_TASKS` binding.

### Data access layer

All D1 queries go through DAO classes in `apps/api/src/dao/` (18 concrete DAOs + `IKeyValueDAO` interface). KV access for credential caching uses `CredentialsCacheDAO` (implements `IKeyValueDAO`). New DAOs beyond the core set include `SpendAlertDAO`, `DataCollectionConfigDAO`, `ResourceInventoryDAO`, `AuditLogDAO`, `CostDataDAO`, `TeamsDAO`, `TeamMembersDAO`, `TeamAccountsDAO`.

### Shared package

`packages/shared/` contains code shared between frontend and backend:

- `packages/shared/src/schema/` — Zod input/output schemas for API validation
- `packages/shared/src/types.ts` — Shared TypeScript interfaces
- `packages/shared/src/utils.ts` — Shared utility functions (ARN building, env export)

Backend imports schemas via `@aws-access-bridge/shared`. Frontend uses types directly from `packages/shared/src/types.ts`.

### Constants organization

`apps/api/src/constants/` contains both top-level files and four topical subdirectories:

- Top-level: `AuditActions.ts`, `ConfigurationDefaults.ts`, `Configurations.ts`, `DemoMode.ts`, `Headers.ts`, `Hostnames.ts`, `RoleSessionNames.ts`
- `apps/api/src/constants/do/` — Durable Object namespace names and internal run URL constants
- `apps/api/src/constants/d1/` — D1 session constraint constants
- `apps/api/src/constants/error/` — Error message constants (e.g., for AssumeRoleUtil, HMACHandler)
- `apps/api/src/constants/kv/` — KV namespace names, TTLs, value type markers

### Path aliases

- Backend (`apps/api`): `@/*` maps to `./apps/api/src/*` (see `apps/api/tsconfig.json`)
- Frontend (`apps/web`): Relative imports within `apps/web/src/` and `apps/web/src/components/`

Always use `@/` imports for backend source code.

### Frontend

React components live in `apps/web/src/components/`. All interactive components use the `'use client'` directive. The Vite SPA entry point is `apps/web/src/SpaApp.tsx` which provides pathname-based client-side view switching.

Key components:

- `apps/web/src/SpaApp.tsx` — SPA shell: auth gate, pathname routing, `SpaNavbar`, accounts/costs/resources/admin views
- `apps/web/src/components/AccountList.tsx` — Main account list with role assumption and favorites
- `apps/web/src/components/AccessKeyModal.tsx` — Displays generated AWS access keys
- `apps/web/src/components/AdminPage.tsx` — Tabbed admin interface organized as a grouped left sidebar:
  - **SETUP**: Setup Wizard
  - **CONFIGURATION**: Credentials, Account Nicknames, Role Config
  - **ACCESS**: User Access, Teams
  - **MONITORING**: Spend Alerts, Data Collection
  - **SYSTEM**: Audit Logs, Maintenance
- `apps/web/src/components/OnboardingWizard.tsx` — Guided admin account setup
- `apps/web/src/components/CostDashboard.tsx` — Cost summary cards, trend bar chart, account breakdown
- `apps/web/src/components/ResourceInventory.tsx` — Resource summary, type/search filters, paginated table
- `apps/web/src/components/AuditLogsTab.tsx` — Filterable, paginated audit log viewer
- `apps/web/src/components/TeamsTab.tsx` — Team management (create/rename/delete, members, accounts)
- `apps/web/src/components/Unauthorized.tsx` — Unauthorized access screen
- `apps/web/src/components/ui/` — Shared primitives (`theme`, `Spinner`, `LoadingButton`, `FocusInput`, `Card`, `Pagination`)
- `apps/web/src/hooks/useAuth.ts` — Shared `fetch('/user/me')` auth gate hook
- `apps/web/src/lib/api.ts` — Shared `apiFetch` JSON/error helper (replaces per-tab `response.text()` parsing)

### TypeScript configuration

Each package has its own `tsconfig.json`:

- `apps/web/tsconfig.json` — Frontend (includes `dom` lib, Vite/client types)
- `apps/api/tsconfig.json` — Backend (no `dom` lib, `apps/api/cloudflare-env.d.ts` binding types)
- `packages/shared/tsconfig.json` — Shared schemas only

The `pnpm typecheck` command runs type-checking on all packages.

### Tests

Vitest (`vitest.config.ts`) runs test files under `test/`, organized by area: `test/constants/` (1), `test/crypto/` (2 — AES-GCM + HMAC), `test/dao/` (14 DAO tests), `test/error/` (1), `test/middleware/` (2 — HMAC and middleware composition), `test/model/` (1), `test/schema/` (1), `test/utils/` (10 util tests), `test/workers/` (2 — AccessBridgeWorker and CronTasksWorker).

## Code Style

- Prettier: 140 char line width, single quotes, semicolons, spaces (not tabs)
- ESLint: typescript-eslint recommended rules; unused vars prefixed with `_` are allowed
- Explicit type annotations are used throughout (e.g., `const x: Type = ...`)
- Models use dual interfaces: `Type` (camelCase, user-facing) and `TypeInternal` (snake_case, D1 schema)

## Configuration

Cloudflare config is split by deploy target. Local/private `wrangler.jsonc` files are gitignored when present. `apps/api/wrangler.template.jsonc` is the public API Worker template with placeholder IDs. `apps/web/wrangler.template.jsonc` is the public web/Pages template with `pages_build_output_dir: "apps/web/dist/"` and an `API_WORKER` service binding to `aws-access-bridge`. The API template has `$version` and `$minimumVersion` fields (commented); CI validates that fork configs are not outdated against `$minimumVersion`.

**Bindings (from template):**

- D1: `AccessBridgeDB` → `aws-access-bridge-db`
- KV: `AccessBridgeKV`
- Durable Object: `CRON_TASKS` → `CronTasksWorker` (singleton name `cron-tasks`)
- Service: `SELF` → `aws-access-bridge` (for internal HMAC-signed self-calls)
- Secrets Store: `AES_ENCRYPTION_KEY_SECRET` (credential encryption), `INTERNAL_HMAC_SECRET` (internal request signing)
- Assets: `./apps/web/dist/` (Vite SPA output)
- Cron: `*/10 * * * *`
- Compatibility date: `2025-11-29`
- Observability logs enabled; traces disabled by default

**Environment variables** (in `vars`):

- `POLICY_AUD` / `TEAM_DOMAIN` — Cloudflare Zero Trust config. **Optional**; only required when the worker and domain live in different Cloudflare accounts (Cloudflare for SaaS). When both are in the same account, Zero Trust's team domain and application AUD are auto-inferred at runtime.
- `MAX_TOKENS_PER_USER` / `MAX_TOKEN_EXPIRY_DAYS` — PAT limits
- `PRINCIPAL_TRUST_CHAIN_LIMIT` — Max credential chain depth
- `AUDIT_LOG_RETENTION_DAYS` — Audit log retention (default 90)
- `DEMO_MODE` — When `"true"`, all admin write operations throw `MethodNotAllowedError` at the base-class level
- `SERVE_SPA_FROM_WORKER` — When `"true"`, the API Worker serves embedded SPA HTML for frontend routes. Template default is `"false"`.

## CI/CD

Deployment runs via GitHub Actions on Node 24 with pnpm. `.github/workflows/deploy-cloudflare-worker.yml` deploys the API Worker: checkout → install pnpm → materialize `wrangler.jsonc` from the `WRANGLER_JSONC` GitHub variable → validate config `$minimumVersion` against `apps/api/wrangler.template.jsonc` → init Cloudflare Secrets Store (`scripts/init-secrets.ts`) → apply D1 migrations → build web app → type-check/build API worker → `wrangler deploy --dry-run` → `wrangler deploy` outside pull requests.

`.github/workflows/deploy-cloudflare-pages.yml` deploys the frontend to Cloudflare Pages: checkout → install pnpm → build web app → copy `apps/web/wrangler.template.jsonc` to `wrangler.jsonc` → `wrangler pages deploy` using `CLOUDFLARE_PAGES_PROJECT_NAME`. Pull requests build but do not deploy.

## Database

26 D1 migrations in `migrations/`. The `credentials_cache` table was created in migration 0014 and dropped in 0017 (caching moved entirely to KV). Current tables:

- `credentials` — Encrypted AWS IAM credentials with assumption chains
- `assumable_roles` — User-to-account-to-role access mappings
- `aws_accounts` — Account metadata and nicknames
- `user_favorite_accounts` — Per-user favorite accounts
- `user_metadata` — User info, superadmin flag, federation username
- `user_access_tokens` — Personal access tokens (PAT)
- `role_configs` — Per-role destination path/region config
- `credential_cache_config` — Tracks credential cache staleness
- `audit_logs` — Activity log for all API requests
- `cost_data` — AWS Cost Explorer data by account and period
- `data_collection_config` — Per-credential opt-in for cost/resource collection
- `spend_alerts` — Configurable cost threshold alerts
- `resource_inventory` — EC2/S3/Lambda/RDS resource snapshots
- `teams` / `team_members` / `team_accounts` — Multi-tenant team workspaces (default team seeded in 0026)

## Git Commit Messages

- Use Conventional Commits with this subject format: `<TYPE>[optional scope]: <description>`.
- Write the type in uppercase, for example `FIX`, `FEAT`, `DOCS`, `STYLE`, `REFACTOR`, `TEST`, `BUILD`, `CHORE`, `CI`, or `PERF`.
- Write the optional scope in lowercase inside parentheses, for example `FEAT(runtime): Add Scheduled Job State`.
- Write the description as concise human-readable words with spaces, capitalizing the first letter of each word, for example `DOCS: Latest Agents Context Reflection`, `STYLE: Standardize Python Formatting`, or `FEAT: Bootstrap JQAnywhere v0.1 Framework`.
- When creating a commit from `main`, first switch to a new branch generated from the planned commit subject.
- Use lowercase slash-separated branch names: `type/description` when there is no scope, or `type/scope/description` when there is a scope.
- Convert the description to kebab-case for the branch, for example `docs/latest-agents-context-reflection`, `docs/agents/document-commit-standard`, or `feat/bootstrap/bootstrap-jqanywhere-v0.1-framework`.
- Use Markdown for optional commit bodies, separated from the subject by a blank line.
- Use optional footers after the body, separated by a blank line, following git trailer-style formatting.
- Use `FIX` for bug patches and `FEAT` for new features; other conventional types are allowed when they better communicate intent.
- Mark breaking API changes with `!` after the type or scope, or with a `BREAKING CHANGE: <description>` footer.

```text
<TYPE>[optional scope]: <description>

[optional body in Markdown]

[optional footer(s)]
```
