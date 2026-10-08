# AWS-AccessBridge — Working In This Repository

Scope: the workspace layout, the commands, the layer rules, and the gates a change has to pass. Parent index: `../../../AGENTS.md`.

Nothing here is a design decision — those live in the area guides. This is the mechanical part: what exists, what runs it, and what refuses to merge.

## The workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*`, and `test`. That is **10 projects**:

| Layer | Projects                                  | May import                                                                                                                   |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0     | `shared`, `backend-errors`                | nothing                                                                                                                      |
| 1     | `backend-runtime` (incl. `di/`)           | layer 0                                                                                                                      |
| 2     | `backend-data`, `provider-clients`        | layer 0                                                                                                                      |
| 3     | `backend-services` (incl. `composition/`) | layers 0–2, never `apps/*`                                                                                                   |
| app   | `background`                              | layers 0–3, never `apps/api`                                                                                                 |
| app   | `api`                                     | layers 0–3 + `background`; no `aws4fetch`, no `provider-clients`; `backend-data/dao` **types only** under `src/endpoints/**` |
| app   | `web`                                     | the browser                                                                                                                  |
| test  | `test`                                    | everything                                                                                                                   |

There is no layer 4 by design: nothing sits between `backend-services` and the entrypoints.

### The layer rules are enforced unevenly, and the gaps are worth knowing

`no-restricted-imports` in `eslint.config.mjs` carries a block for `shared`, `backend-errors`, `backend-runtime`, `backend-data`, `provider-clients`, `backend-services`, `apps/api`, and `apps/api/src/endpoints/**`. **There is no block for `apps/background` or `apps/web`** — those two rows are convention, not enforcement, so a wrong import there fails nothing. If you add a package, add its block with it rather than after.

Two further asymmetries in the enforced set: `backend-runtime` and `backend-data` do **not** name `provider-clients` as restricted, so an upward import into it type-checks today. And the `apps/api/src/endpoints/**` DAO block sets `allowTypeImports: true`, which is the one permitted value import — type-only DAO imports for filters and models.

### `scripts/` and `functions/` are not workspace packages

`pnpm run typecheck` reaches them through `typecheck:scripts` and `typecheck:functions`, so a new directory there needs its own script or nothing checks it at all. `functions/[[path]].ts` is the Cloudflare Pages entrypoint that proxies to the worker over the `API_WORKER` service binding, which is the one place the two wrangler templates are coupled. `scripts/README.md` documents the entrypoint-vs-module convention (`#!` files export nothing, so `unicorn/no-exports-in-scripts` leaves them lintable).

`test/` **is** a workspace project, so `pnpm -r typecheck` and `pnpm run lint` both reach it. It has its own `node_modules`, which is why both Vitest projects re-list `**/node_modules/**` in `exclude` — naming `exclude` at all replaces Vitest's defaults rather than adding to them.

## Commands

```bash
pnpm install
pnpm run checks          # checks:fast, then coverage, then the floor gate, then integration
pnpm run checks:fast     # typecheck + lint + god-files + migrations + locales + SPA shell
pnpm run typecheck       # -r, plus scripts/ and functions/
pnpm run lint            # eslint --fix --quiet
pnpm run check:god-files # 300 warn / 400 error
pnpm run validate:migrations   # read-only; refuses an edited or unlocked migration
pnpm run migrations:lock       # records a NEW migration; never re-hashes an applied one
pnpm run validate:locales
pnpm run verify:spa-shell      # needs `pnpm --filter @aws-access-bridge/web build` first
pnpm run test
pnpm run test:coverage   # with the aggregate coverage gate
pnpm run check:coverage-floor # per-file floors; reads the report test:coverage writes
pnpm run test:integration
pnpm run test:floci      # needs the emulator; deliberately NOT in `checks`
pnpm --filter @aws-access-bridge/web run build  # the only build script
pnpm run typegen         # wrangler types from apps/api/wrangler.template.jsonc
pnpm exec wrangler dev --config ./wrangler.jsonc
```

Plain `pnpm` is canonical — no `source ~/.customrc`, no `volta run` prefix. `pnpm --filter @aws-access-bridge/web run build` resolves to exactly one thing, the SPA's `vite build`, so `pnpm run build` "succeeding" can still mean the embedded shell is the stub `postinstall` wrote. `verify:spa-shell` is the check for that, and it is in `checks:fast`.

`pnpm run lint` sets `NODE_OPTIONS=--max-old-space-size=6144` itself, because type-aware ESLint exhausts the default heap here. Prefix any _manual_ `eslint`/`vitest` invocation with the same flag rather than raising the script's limit. `test/package.json` sets its own 4 GB for the same reason: `test/tsconfig.json` is the only project that pulls in every package at once, and tsc emits no `error TS` line when V8 kills it, so the failure is indistinguishable from a clean run.

## The gates

**Aggregate coverage is `94 / 83 / 94 / 94`** (statements / branches / functions / lines), against a measured 94.03 / 83.11 / 94.17 / 94.45. It is a _measured_ floor: lower it to make CI green and the gate stops saying anything. See [`../testing/AGENTS.md`](../testing/AGENTS.md) for what is in `include`, and why hooks and components are not.

**Per-file floors** (`pnpm run check:coverage-floor`) pin 32 files whose _regression_ would matter — the auth boundary, request validation, credential encryption, data integrity, the background pipeline, routing, and logging. An aggregate can be met while one of those rots, which is how `MiddlewareHandlers` sat at 61.5% branch while the total looked healthy. The floors are _measured_ figures minus a few points, so ordinary churn does not fail the build but half a file's branch coverage going missing does — they used to sit 40-60 points under the measurement, which is no gate at all. Floors are keyed by path _suffix_, so a file move cannot silently drop one; a floor naming an absent file warns rather than fails, so stale config is never what blocks a deploy.

**The god-file guard** is 300 warn / 400 error, counting `split('\n').length`. It skips `node_modules`, `dist`, `.wrangler`, coverage directories, `.git`, `locales/`, `generated/`, `__tests__`/`__mocks__`, `scripts/`, test files, `*.d.ts`, and every `.md`/`.json`/`.sql`. No file currently sits over the soft limit: the wizard that used to warn is split into per-step hooks, and `MiddlewareHandlers` shed its pre-authentication guards into `RequestGuards.ts`.

**`validate:migrations` is read-only and fails on an edit.** D1 records applied migrations by _filename_, so a file that has run is skipped silently by every later `wrangler d1 migrations apply`: the deploy succeeds, fresh databases pick up the edited statements, production keeps the schema it had. `migrations/migrations.lock.json` records a SHA-256 per file, with everything at or before the squashed baseline exempt. See [`../runtime/AGENTS.md`](../runtime/AGENTS.md).

**`validate:locales`** compares the twelve web bundles for key parity, placeholder parity, and non-empty values _including in `en`_, and cross-checks the declared tag lists against the `locales/` directories in both directions. Locale catalogs are data: a key missing from eleven bundles still typechecks and still builds.

## What is generated, and what is not

| Path                                  | Generated by                                           | Tracked                                         |
| ------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `worker-configuration.d.ts`           | `pnpm run typegen` (also `postinstall`)                | yes                                             |
| `apps/api/src/generated/spa-shell.ts` | the web build                                          | no — gitignored, verified by `verify:spa-shell` |
| `apps/web/dist/`                      | the web build                                          | no                                              |
| `migrations/migrations.lock.json`     | `pnpm run migrations:lock`, on adding a migration only | yes                                             |
| `wrangler.jsonc`                      | copied from `apps/api/wrangler.template.jsonc`         | no — gitignored                                 |
| `coverage/`                           | `pnpm run test:coverage`                               | no                                              |

`packages/backend-runtime/src/env.d.ts` is the checked-in binding source of truth and the fourth place a binding has to appear alongside the template, the generated types, and `ServiceEnv`. A binding present in three of the four is the failure mode worth avoiding.

## CI

`.github/workflows/continuous-integration.yml` runs **one job per check**, so a red pipeline names its failure rather than arriving inside a typecheck log: `typecheck`, `lint`, `migrations`, `god-files`, `locales`, `unit-tests`, `integration-tests`, `floci-smoke`, `build-web`, `spa-shell`. `spa-shell` builds the SPA itself rather than depending on `build-web` — that costs a second Vite build per run and buys a failure that says "the served shell is wrong". `continuous-deployment.yml` deploys the worker and the Pages target; `backup-d1.yml` is the nightly export, off until a destination is configured. The job names are the documentation of what each one proves.

## Cloudflare documentation

**STOP.** APIs, limits, and behaviour change frequently. Before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or Agents SDK task, retrieve current official docs rather than trusting recall.

- Workers: https://developers.cloudflare.com/workers/
- Cloudflare MCP: https://docs.mcp.cloudflare.com/mcp
- Node.js compat: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Worker errors: https://developers.cloudflare.com/workers/observability/errors/ — **error 1102 is CPU/memory exceeded**
- Limits: fetch each product's `/platform/limits/` page (e.g. `/workers/platform/limits/`)
- Product refs: `/workers/`, `/kv/`, `/r2/`, `/d1/`, `/durable-objects/`, `/queues/`, `/vectorize/`, `/workers-ai/`, `/agents/`
- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Worker-level Access (`ctx.access.getIdentity()`, no JWT parsing): https://developers.cloudflare.com/workers/configuration/cloudflare-access/ — this is the var-less fallback in `AccessAuthService`

## Adding a directory

A new `apps/*` or `packages/*` directory needs a `package.json` with a `typecheck` script, a `tsconfig.json`, and a layer decision — which is a decision about what it may import, so add the `no-restricted-imports` block with it. A new `scripts/*` or `functions/*` directory needs its own `typecheck:*` script, since neither is in the workspace. Either way, add the area to the root [`AGENTS.md`](../../../AGENTS.md) index and write the guide in the same change.
