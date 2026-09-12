# AWS-AccessBridge — Runtime And Configuration

Scope: Wrangler bindings, build output, env vars. Parent index: `../../../AGENTS.md`.

- Root package `@aws-access-bridge/monorepo`, pnpm workspaces (`apps/*`, `packages/*`).
- `apps/web/vite.config.ts` proxies `/api` + `/user` → `http://localhost:8787` in dev; `closeBundle` embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`) on build.
- `apps/api/wrangler.template.jsonc` is the config template — copy to `wrangler.jsonc` per deployer; no committed `wrangler.jsonc`. Materialized by `scripts/prepare-wrangler-config.ts` (fills `000…` placeholder IDs, `$minimumVersion` fork-staleness check).
- The Worker serves the SPA only from its page-route catch-all (`AccessBridgeWorker`: `/user/*` JSON and `/api/*` JSON never fall through to HTML) so API routes aren't intercepted by the assets handler.
- Worker bindings: D1 `AccessBridgeDB`, KV `AccessBridgeKV`, Secrets Store `AES_ENCRYPTION_KEY_SECRET` / `INTERNAL_HMAC_SECRET`, DO `CRON_TASKS`, service binding `SELF`, cron `*/10 * * * *`. Binding source of truth: `packages/backend-runtime/src/env.d.ts` (checked in) + generated root `worker-configuration.d.ts` (`pnpm run typegen`).
- `functions/[[path]].ts` — Pages catch-all proxy → `API_WORKER.fetch()` with `X-Forwarded-*` headers.

## Required vars (no defaults)

`POLICY_AUD`, `TEAM_DOMAIN` — Cloudflare Access JWT verification (`AccessAuthService`). No default; requests fail without them.

## Local-only (no default, not in `ConfigurationDefaults.ts`)

`DEV_AUTH_EMAIL` — bypasses Cloudflare Access locally.

## Optional vars (defaults in `ConfigurationDefaults.ts`, read via `ConfigurationManager` namespaces)

| Group      | Vars (default)                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens     | `MAX_TOKENS_PER_USER` (`5`), `MAX_TOKEN_EXPIRY_DAYS` (`90`) — `ConfigurationManager.token`                                                                                                                 |
| Credential | `PRINCIPAL_TRUST_CHAIN_LIMIT` (`3`), `CREDENTIAL_EXPIRY_BUFFER_MINUTES` (`5`), `NUMBER_OF_CREDENTIALS_TO_REFRESH` (`10`), `CREDENTIAL_REFRESH_INTERVAL_MINUTES` (`45`) — `ConfigurationManager.credential` |
| Collection | `COST_COLLECTION_INTERVAL_HOURS` (`6`), `COST_LOOKBACK_DAYS` (`30`), `RESOURCE_COLLECTION_INTERVAL_HOURS` (`2`) — `ConfigurationManager.costs` / `.resource`                                               |
| Retention  | `AUDIT_LOG_RETENTION_DAYS` (`90`), `BACKGROUND_TASK_RUN_RETENTION_DAYS` (`30`), `PRUNE_BATCH_SIZE` (`500`) — `ConfigurationManager.audit` / `.processing`                                                  |
| SPA        | `SERVE_SPA_FROM_WORKER` (`false`) — `ConfigurationManager.spa`                                                                                                                                             |
| Internal   | `INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS` (`1000`) — `ConfigurationManager.internal`                                                                                                               |
| Misc       | `DEMO_MODE` (`false`) — `ConfigurationManager.auth`                                                                                                                                                        |

Add new env vars in `ConfigurationDefaults.ts` + a `ConfigurationManager` namespace getter, not inline. Never `parseInt(env.X || DEFAULT)` at call sites.
