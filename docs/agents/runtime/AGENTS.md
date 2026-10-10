# AWS-AccessBridge — Runtime And Configuration

Scope: Wrangler bindings, build output, migrations, env vars. Parent index: [`../../../AGENTS.md`](../../../AGENTS.md). Workspace layout and the layer table: [`../repo/AGENTS.md`](../repo/AGENTS.md).

- Root package `@aws-access-bridge/monorepo`, pnpm workspaces (`apps/*`, `packages/*`, `test`): `shared`, `backend-errors` (Layer 0); `backend-runtime` incl. `di/` (`Container`) (Layer 1); `backend-data`, `provider-clients` (raw AWS STS/CE/IAM + signed-fetch; Layer 2); `backend-services` incl. `composition/` (`ServiceEnv`, `Tokens`, `createRequestScope`, `getRequestScope`) (Layer 3).
- `apps/web/vite.config.ts` proxies `/api` + `/user` → `http://localhost:8787` in dev; `closeBundle` embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`) on build.
- `apps/api/wrangler.template.jsonc` is the config template — copy to `wrangler.jsonc` per deployer; no committed `wrangler.jsonc`. Materialized by `scripts/deploy/prepare-wrangler-config.ts` (writes `WRANGLER_JSONC` or falls back to copying the template; `WRANGLER_PATCH_JSON` top-level merge + `WRANGLER_VARS_PATCH_JSON` vars merge, then the template-coverage check, then fills `000…` placeholder IDs and auto-provisions missing D1/KV/Secrets Store resources). The entrypoint is five ordered calls into `scripts/lib/wrangler-config/`.

**The coverage check is structural, not a version integer.** `template-coverage.ts` requires every D1/KV/Secrets Store/DO/service binding name and every `vars` key the template declares to be _present_ in the materialized `wrangler.jsonc` — never equal, since a deployment fills `POLICY_AUD`/`TEAM_DOMAIN` with its own values. It replaced a `$version`/`$minimumVersion` pair that must stay **commented** in the template: those keys are not in wrangler's schema (it flags them and suggests an upgrade), and the original guard read them with `grep`, which matches comments. The port to `jsonc-parser` dropped the comments, so `prepareConfigFile`'s copy of the template arrived with no `$version` and the nightly backup died at 04:15 UTC refusing the file it had just written. One key class is excluded: KV bindings (`ensureRequiredKvBindings` injects them, so requiring one rejects a config about to be completed). The check runs _after_ both patches — so a var supplied by `WRANGLER_VARS_PATCH_JSON` counts — and _before_ provisioning, so a config that cannot deploy never creates a D1 database on the way to finding out. Unit-tested in `test/scripts/wrangler-config-coverage.test.ts`.

- The Worker serves the SPA only from its page-route catch-all (`AccessBridgeWorker`: `/user/*` JSON and `/api/*` JSON never fall through to HTML) so API routes aren't intercepted by the assets handler.
- Worker bindings: D1 `AccessBridgeDB`, KV `AccessBridgeKV`, Secrets Store `CREDENTIAL_ENCRYPTION_KEY_SECRET` / `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` / `INTERNAL_REQUEST_HMAC_SECRET`, DO `CRON_TASKS`, service binding `SELF`, cron `*/10 * * * *`.
- **Workflow `COLLECTION_WORKFLOW`** (`aws-access-bridge-collection`, class `CollectionWorkflow`): the two collection sweeps. The cron DO starts one instance per tick and no longer walks accounts and regions inside its own request, where a wedged AWS call held the `already_running` guard. Each task is a named step, so a step's result and its single retry are addressable. Optional in code: with no binding, `CronTasksWorker` runs both tasks inline exactly as before.
- **Rate limit `AUTH_RATE_LIMITER`**: namespace `1001`, 120 calls per 60s, keyed on `CF-Connecting-IP` in front of the `/api/*` auth boundary. Optional at runtime (the middleware fails open) but declared in the template, so the structural coverage check refuses a config that would silently ship without it.

**Per-feature encryption keys.** Each encrypted surface has its own key: `CREDENTIAL_ENCRYPTION_KEY_SECRET` for the `credentials` D1 table, `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` for the `credentials_cache` KV namespace. Reads and writes both use the surface's own key. The former single `AES_ENCRYPTION_KEY_SECRET` (and the `AES_ENCRYPTION_KEY` dev var) were a read-only fallback for rows written before the split; they are gone, so a row that is still encrypted only under it can no longer be read. An existing deployment can delete the `aws-access-bridge-aes-encryption-key` secret from its Secrets Store after deploying — `init-secrets.ts` no longer creates it, seeds from it, or deletes it. `INTERNAL_HMAC_SECRET` was renamed to `INTERNAL_REQUEST_HMAC_SECRET` for naming consistency; it was already single-purpose. Binding source of truth: `packages/backend-runtime/src/env.d.ts` (checked in) + generated root `worker-configuration.d.ts` (`pnpm run typegen`).

**The plaintext `CREDENTIAL_ENCRYPTION_KEY` / `CREDENTIAL_CACHE_ENCRYPTION_KEY` vars are refused when
`ENVIRONMENT` is `production`.** `composition/encryptionKeys.ts` reads them as a fallback for local
development and tests, which have no Secrets Store, and it used to read them unconditionally — which
meant a production deployment could encrypt the IAM credentials table with a key sitting in an
ordinary env var while the code reported a Secrets Store key in use. The fallback is now gated on
`ConfigurationManager.environment.isProduction`, so a deployment with no binding and only the raw var
**fails loudly** with `InternalServerError` rather than encrypting under a weaker boundary.
`isProduction` is the literal string `production` — not `prod`, not unset — so a staging environment
still gets the var fallback. This is an availability-breaking change for any deployment that only
ever set the raw var: bind `CREDENTIAL_ENCRYPTION_KEY_SECRET` /
`CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` in the Secrets Store (`scripts/deploy/init-secrets.ts`
creates them) before deploying the version that introduced this.

- `functions/[[path]].ts` — Pages catch-all proxy → `API_WORKER.fetch()` with `X-Forwarded-*` headers.

## Migrations

Apply with `pnpm exec wrangler d1 migrations apply aws-access-bridge-db [--local|--remote]` (requires a materialized `wrangler.jsonc`, or pass `--config`). There are five migration files: `0030_squash.sql` is the squashed baseline for fresh databases, `0031_distinct_credential_ivs.sql` adds the per-field IV columns, `0032_user_identity.sql` adds the identity columns and the `user_emails` registry, `0033_collection_attempt_timestamps.sql` adds `data_collection_config.last_attempt_at`, and `0034_pat_hashed_tokens.sql` replaces plaintext PAT storage with a `token_hash` column and a unique index. The incrementals guard their `ADD COLUMN`, but the harness must not re-apply a file.

**`0034` invalidates every existing personal access token — deliberately.** There is no SQL-side way to hash a stored token retroactively, so it drops the rows (with the column) rather than leaving live bearer credentials readable in a row or a backup. Tokens are short-lived (≤ 90 days), few (≤ 5 per user), and re-minting is self-service; it is a breaking change worth recording in the release notes.

## Migration lock

`migrations/migrations.lock.json` records a SHA-256 per migration. D1 tracks _which_ migrations it applied but not _what they contained_, so editing an applied migration is otherwise invisible: the deploy succeeds, fresh databases pick up the edited statements, production keeps the old schema, and the split is permanent. Verify with `pnpm run validate:migrations` (a dedicated `migrations` CI job; the rules are in `scripts/migrations/lock-check.ts`, unit-tested in `test/scripts/migration-lock.test.ts`). After adding a migration: `pnpm run migrations:lock`.

Findings: `absent` / `malformed` (the lock itself), `edited` / `unlocked` / `orphan` (a file), and `name` / `duplicate-prefix` / `out-of-order` — a duplicate `NNNN_` prefix, a name that is not `NNNN_snake_case.sql`, or a new file sorting before an already-locked one. The last three are ordering bugs rather than style, because D1 applies in filename order.

**The baseline exemption is the squash case.** `baseline` is the highest-numbered `NNNN_squash.sql` on disk, derived from disk rather than trusted from the lock, and everything at or before it is exempt from `edited` and `orphan`. That is exactly the set a squash rewrites (`0030_squash.sql`) or absorbs (the files it deleted), so committing a squash is legitimate and must not be reported as drift. Everything _strictly after_ the baseline is incremental, has been applied on top of it, and is immutable — that is the only set where a divergence can be silent. `pnpm run migrations:lock` therefore refreshes the baseline, prunes absorbed entries, and advances `baseline` to a new squash in one step; a repo with no squash has no `baseline` key and every migration is immutable. `--write` never adopts the digest of a drifted _incremental_ migration, so a stray run cannot bless an edit; re-baselining one means hand-deleting its entry, which shows up in the diff. Digests are over raw bytes, so line endings are not normalized — Prettier has no SQL parser and never reformats these files.

`0032_user_identity.sql` must be applied **before or with** the first deploy of the identity-decoupled code. It is purely additive — `user_metadata.user_email` stays the frozen anchor and primary key, because D1 honours neither `PRAGMA foreign_keys = off` nor `PRAGMA legacy_alter_table = on`, and `defer_foreign_keys` does not suppress the `ON DELETE CASCADE` from `user_access_tokens`. The DAOs tolerate a database without it (they fall back to address lookups, via `isMissingSchemaError`), so a partially-migrated database still authenticates — but identity-keyed reads only key on `user_id` after the backfill, and provisioning stamps `id`/`current_email` only where those columns exist.

Accounts whose address collides case-insensitively with another account (e.g. `Alice@x.com` alongside `alice@x.com`) are deliberately left with `user_metadata.current_email IS NULL`; find them with `SELECT user_email FROM user_metadata WHERE current_email IS NULL` and merge them out of band.

Changing a sign-in address: `scripts/ops/change-email.ts` (see `packages/backend-data/AGENTS.md` for the anchor rationale). It refuses an address already live for another account, case-insensitively.

## Backups

`.github/workflows/backup-d1.yml` exports `AccessBridgeDB` daily at 04:15 UTC (`workflow_dispatch` for manual runs). Job graph: `check-secrets` (preflight, emits `cloudflare`/`encryption`/`s3`/`webdav` booleans) → `export-d1` (materializes `wrangler.jsonc` through the same `scripts/deploy/prepare-wrangler-config.ts` the deploy uses, then `wrangler d1 export --remote`, xz, AES-256-CBC) → `backup-s3` / `backup-webdav` consume the encrypted `d1-backup` artifact (1-day retention). With no destination secret set every backup job skips; with a destination set but no `BACKUP_ENCRYPTION_KEY`, `check-secrets` fails — encryption is mandatory because `user_access_tokens.access_token` is plaintext and is looked up directly for `/api/*` auth. `export-d1` aborts when `database_id` is still the `000…` placeholder, since that means `prepare-wrangler-config.ts` just auto-created the database. The guard and the value it compares against are the same `DEFAULT_UUID` constant (`scripts/lib/wrangler-config/types.ts`) that provisioning writes over, so they cannot drift apart. Object prefix `aws-access-bridge/production/`, file `access-bridge_prod_<UTC timestamp>.sql.xz.enc`, pruned past `BACKUP_RETENTION_DAYS` (`isBackupArtifact` still matches `.gz` so pre-xz objects age out). Playbook (secrets, restore, Time Travel 30d Paid / 7d Free): `docs/db-backup-recovery.md`.

The workflow holds no logic: every step runs a `scripts/backup/*.ts` entrypoint via `pnpm exec tsx` (`evaluate-destination-config`, `resolve-d1-target`, `encrypt-backup`, `upload-s3`, `upload-webdav`). Guards live in sibling modules without a `#!` line (`destination-config`, `d1-target`, `naming`, `s3-prune`, `webdav-target`, `retention`) so they export freely and are unit-tested in `test/backup/`. Notes when changing them:

- `BACKUP_ENCRYPTION_KEY` is read from the environment, never from argv — arguments are visible to any process on the runner via `ps`. openssl takes it through `-pass env:`.
- Compression is `xz -T0 -6`, not gzip. Unlike gzip, xz leaves its input in place, so `encrypt-backup.ts` must `rmSync` the plaintext itself. `xz-utils` is preinstalled on `ubuntu-latest`; adding zstd would mean installing it first.
- Inputs arrive as env vars (`BACKUP_FILE` from `needs.export-d1.outputs.backup-file`); outputs go to `$GITHUB_OUTPUT` via `scripts/lib/github-actions.ts`. No `@actions/*` dependency, so the scripts stay runnable with plain `tsx`.
- Secrets still have to be declared in the workflow's `env:` block — a script cannot read them on its own.
- Every job that runs a script needs `actions/checkout` plus `./.github/actions/setup-env` to get `tsx` on `PATH`.
- `wrangler d1 info` takes no `--remote` flag (it always acts on the remote database). Passing one makes wrangler exit non-zero on an unknown argument, which `resolve-d1-target` reports as an unreadable database.
- `scripts/**` is linted and typechecked (`typecheck:scripts`, wired into `pnpm run checks`), so a broken guard fails CI rather than a job.

## Auth vars (JWT config optional with Worker-level Access)

`POLICY_AUD`, `TEAM_DOMAIN` — Cloudflare Access JWT verification (`AccessAuthService`). Set both for self-hosted Access applications and cross-account (Cloudflare for SaaS) setups — explicit vars always win. When both are unset, requests authenticate via the platform-verified Worker-level Access identity (`ctx.access.getIdentity()`, threaded through `MiddlewareHandlers.authenticateUserIdentity`); enable one-click Access on the worker for same-account deploys that omit the vars.

## Local-only (no default, not in `ConfigurationDefaults.ts`)

`DEV_AUTH_EMAIL` — bypasses Cloudflare Access locally. Read _before_ JWT verification, so it is refused outright when `ENVIRONMENT` is `production` rather than authenticating: a `.dev.vars` promoted by mistake would otherwise grant every caller that address, including super-admin and `/api/aws/assume-role`.

## Optional vars (defaults in `ConfigurationDefaults.ts`, read via `ConfigurationManager` namespaces)

| Group       | Vars (default)                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens      | `MAX_TOKENS_PER_USER` (`5`), `MAX_TOKEN_EXPIRY_DAYS` (`90`) — `ConfigurationManager.token`                                                                                                                                                                                                              |
| Credential  | `PRINCIPAL_TRUST_CHAIN_LIMIT` (`3`) — **max principals a chain may have**; a longer chain is refused, warm or cold | `NUMBER_OF_CREDENTIALS_TO_REFRESH` (`10`), `CREDENTIAL_REFRESH_INTERVAL_MINUTES` (`45`) — `ConfigurationManager.credential` |
| Collection  | `COST_COLLECTION_INTERVAL_HOURS` (`6`), `COST_LOOKBACK_DAYS` (`30`), `RESOURCE_COLLECTION_INTERVAL_HOURS` (`2`), `INVENTORY_REGIONS` (unset → the built-in commercial-region list in `backend-runtime/src/constants/InventoryRegions.ts`; comma-separated) — `ConfigurationManager.costs` / `.resource` |
| Retention   | `AUDIT_LOG_RETENTION_DAYS` (`90`), `BACKGROUND_TASK_RUN_RETENTION_DAYS` (`30`), `PRUNE_BATCH_SIZE` (`500`) — `ConfigurationManager.audit` / `.processing`                                                                                                                                               |
| Internal    | `INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS` (`1000`) — `ConfigurationManager.internal`                                                                                                                                                                                                            |
| Misc        | `DEMO_MODE` (`false`) — `ConfigurationManager.auth`                                                                                                                                                                                                                                                     |
| Environment | `ENVIRONMENT` (`development`) — `ConfigurationManager.environment.isProduction`. Only the literal `production` changes behaviour (it arms the `DEV_AUTH_EMAIL` guard); `prod`/`Production`/unset do not                                                                                                 |

Add new env vars in `ConfigurationDefaults.ts` + a `ConfigurationManager` namespace getter, not inline. Never `parseInt(env.X || DEFAULT)` at call sites.
