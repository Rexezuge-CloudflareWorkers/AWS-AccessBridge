# AWS-AccessBridge — Working In This Repository

Scope: the workspace layout, the commands, the layer rules, and the gates a change has to pass. Parent index: `../../../AGENTS.md`.

Nothing here is a design decision — those live in the area guides. This is the mechanical part: what exists, what runs it, and what refuses to merge.

## The workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*`, and `test` — **nine projects**: three apps, five packages, and the test suite.

| Layer | Projects                                                                                                                                      | May import                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | SDK `@rexezuge/shared`, `@rexezuge/errors`                                                                                                    | nothing                                                                                                         |
| 1     | workspace `shared` (AWS constants, models, schemas, redacting `Logger`)                                                                       | the SDKs only — it bans every other workspace package                                                           |
| 2     | `backend-runtime` (config, worker adapters, DO constants), `backend-data` (DAOs, AES-GCM), `provider-clients` (raw STS/CE/IAM + signed fetch) | layers 0–1, but **never each other** — all three ban one another                                                |
| 3     | `backend-services` incl. `composition/`                                                                                                       | layers 0–2, never `apps/*`                                                                                      |
| app   | `background`                                                                                                                                  | layers 0–3, never `apps/api` — convention, not enforced                                                         |
| app   | `api`                                                                                                                                         | layers 0–3 + `background`; no `aws4fetch`, no `provider-clients`, no DAO values (type-only DAO imports allowed) |
| app   | `web`                                                                                                                                         | the browser — convention, not enforced                                                                          |
| test  | `test`                                                                                                                                        | everything                                                                                                      |

Nothing sits between `backend-services` and the entrypoints; that is the design. `no-restricted-imports` (generated from `projectDirs` + `extraLayers` in `eslint.config.mjs`) carries the five package blocks and one `apps/api` entry — **there is no block for `apps/background` or `apps/web`**, so those rows are convention and a wrong import there fails nothing. If you add a package, add its block with it rather than after.

`scripts/` and `functions/` are not workspace packages: `pnpm run typecheck` reaches them through `typecheck:scripts` and `typecheck:functions`, so a new directory there needs its own script or nothing checks it. `functions/[[path]].ts` is the Pages entrypoint that proxies to the worker over the `API_WORKER` binding — the one place the two wrangler templates are coupled. `scripts/README.md` documents the entrypoint-vs-module convention (`#!` files export nothing, so `unicorn/no-exports-in-scripts` leaves them lintable).

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

Plain `pnpm` is canonical — no `source ~/.customrc`, no `volta run` prefix. `pnpm --filter @aws-access-bridge/web run build` resolves to exactly one thing, the SPA's `vite build`, so `pnpm run build` "succeeding" can still mean the embedded shell is the stub `postinstall` wrote; `verify:spa-shell` is the check for that and it is in `checks:fast`.

`pnpm run lint` sets `NODE_OPTIONS=--max-old-space-size=6144` itself, because type-aware ESLint exhausts the default heap here; prefix any _manual_ `eslint`/`vitest` invocation with the same flag. `test/package.json` sets its own 4 GB for the same reason: `test/tsconfig.json` pulls in every package at once, and tsc emits no `error TS` line when V8 kills it — the failure is indistinguishable from a clean run.

## The gates

**Aggregate coverage is `94 / 83 / 94 / 94`** (statements / branches / functions / lines), a little under the measured 94.03 / 83.11 / 94.17 / 94.45. It is a _measured_ floor: lower it to make CI green and the gate stops saying anything. See [`../testing/AGENTS.md`](../testing/AGENTS.md) for what is in `include` and why hooks and components are not.

**Per-file floors** (`pnpm run check:coverage-floor`) pin 34 files whose _regression_ would matter — the auth boundary, request validation, credential encryption and chain resolution, data integrity, the background pipeline, routing, and logging (the full list and rationale live in [`../testing/AGENTS.md`](../testing/AGENTS.md)). An aggregate can be met while one of those rots, which is how `MiddlewareHandlers` sat at 61.5% branch while the total looked healthy. Floors are measured figures minus a few points, keyed by path _suffix_ so a file move cannot silently drop one, and a floor naming an absent file warns rather than fails.

**The god-file guard** is 300 warn / 400 error, counting `split('\n').length`. It skips `node_modules`, `dist`, `.wrangler`, coverage directories, `.git`, `locales/`, `generated/`, `__tests__`/`__mocks__`, `scripts/`, test files, `*.d.ts`, and every `.md`/`.json`/`.sql`.

**`validate:migrations` is read-only and fails on an edit.** D1 records applied migrations by _filename_, so a file that has run is skipped silently by every later `wrangler d1 migrations apply`: the deploy succeeds, fresh databases pick up the edited statements, production keeps the schema it had. `migrations/migrations.lock.json` records a SHA-256 per file, with everything at or before the squashed baseline exempt. See [`../runtime/AGENTS.md`](../runtime/AGENTS.md).

**`validate:locales`** compares the twelve web bundles for key parity, placeholder parity, and non-empty values _including in `en`_, checks every `t()` call site resolves with an inline default that matches `en`, and reports dynamic keys it cannot check. Locale catalogs are data: a key missing from eleven bundles still typechecks and still builds.

**The kit's own `validate-locales` is not the gate here.** Its entrypoint guard was a silent no-op under pnpm until 1.8.0 (it compared `import.meta.url` against `process.argv[1]`, never matched, and exited 0 having printed nothing); the fixed version now runs over these bundles, but the swap is its own change. **Verify a locale gate that is new to you before trusting it: inject a key into one bundle and confirm it fails.**

## `@rexezuge/tooling`: what is adopted, and what is deliberately not

`eslint.config.mjs`, `vitest.config.mts` and `test/integration/vitest.config.mts` are on the kit's factories. Four scripts are kept local, each for a specific reason:

| Kept                                         | Why                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/i18n/validate_locales.ts`           | The gate wired into `checks` and the `locales` CI job; the kit's fixed version has not been swapped in yet.                                                                    |
| `scripts/migrations/verify-*`                | The kit's `verify-migrations` and `migrations-lock` use a different lock format, and re-recording hashes would make `validate:migrations` a different gate than the one in CI. |
| `scripts/check-god-files.mjs`                | No kit equivalent at the 300/400 threshold this repo uses, and none for the coverage-floor check either.                                                                       |
| `ensure-spa-shell-stub` / `verify-spa-shell` | The kit's invariant is inverted: it asserts the shell stub is **absent** in development and present in a build, where this repo's is that a build replaced the stub.           |

The eslint factory ignores `scripts/**`, which is the wrong default here — `verify-migrations.ts` is TypeScript _so that_ it is linted, and it is the gate that decides whether a migration may be edited. `extraIgnores: ['!scripts/**']` un-ignores it (a global ignore cannot be undone by a later config object, so the negated pattern goes in the same list).

## What is generated, and what is not

| Path                                  | Generated by                                           | Tracked                                                |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `worker-configuration.d.ts`           | `pnpm run typegen` (also `postinstall`)                | no — gitignored; binding source of truth is `env.d.ts` |
| `apps/api/src/generated/spa-shell.ts` | the web build                                          | no — gitignored, verified by `verify:spa-shell`        |
| `apps/web/dist/`                      | the web build                                          | no                                                     |
| `migrations/migrations.lock.json`     | `pnpm run migrations:lock`, on adding a migration only | yes                                                    |
| `wrangler.jsonc`                      | copied from `apps/api/wrangler.template.jsonc`         | no — gitignored                                        |
| `coverage/`                           | `pnpm run test:coverage`                               | no                                                     |

`packages/backend-runtime/src/env.d.ts` is the checked-in binding source of truth and the fourth place a binding has to appear alongside the template, the generated types, and `ServiceEnv`. A binding present in three of the four is the failure mode worth avoiding.

## CI

`.github/workflows/continuous-integration.yml` runs **one job per check**, so a red pipeline names its failure rather than arriving inside a typecheck log: `typecheck`, `lint`, `migrations`, `god-files`, `locales`, `unit-tests`, `integration-tests`, `floci-smoke`, `build-web`, `spa-shell`. `spa-shell` builds the SPA itself rather than depending on `build-web` — a second Vite build per run in exchange for a failure that says "the served shell is wrong". `dependabot-auto-merge` and the upstream-sync dispatch ride in the same workflow; the dispatch job matches the `repository_dispatch` action — the `event_type` `upstream-sync.yml` sends — so the two names move together or the job is skipped while CI stays green.

Around it: `continuous-deployment.yml` deploys the worker and the Pages target on a green CI run (plus `workflow_dispatch` / `repository_dispatch`), `backup-d1.yml` is the nightly D1 export (off until a destination is configured), `backup-main.yml` mirrors the repository to its Azure DevOps / GitLab destinations on pushes to `main` and daily, `upstream-sync.yml` pulls from upstream weekly, and `scheduled-version-update.yml` writes the `.github/.version` timestamp twice a month.

## Cloudflare documentation

**STOP.** APIs, limits, and behaviour change frequently. Before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or Agents SDK task, retrieve current official docs rather than trusting recall: Workers (https://developers.cloudflare.com/workers/), Cloudflare MCP (https://docs.mcp.cloudflare.com/mcp), Node.js compat (https://developers.cloudflare.com/workers/runtime-apis/nodejs/), Durable Objects rules (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), and Worker-level Access (`ctx.access.getIdentity()`, no JWT parsing: https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Errors: https://developers.cloudflare.com/workers/observability/errors/ — **error 1102 is CPU/memory exceeded**. Limits: fetch each product's `/platform/limits/` page.

## Adding a directory

A new `apps/*` or `packages/*` directory needs a `package.json` with a `typecheck` script, a `tsconfig.json`, and a layer decision — which is a decision about what it may import, so add the `no-restricted-imports` block with it. A new `scripts/*` or `functions/*` directory needs its own `typecheck:*` script, since neither is in the workspace. Either way, add the area to the root [`AGENTS.md`](../../../AGENTS.md) index and write the guide in the same change.
