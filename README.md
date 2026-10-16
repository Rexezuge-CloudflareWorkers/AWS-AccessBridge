# AWS AccessBridge

![Accounts Page Preview](https://raw.githubusercontent.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge-Assets/refs/heads/main/pictures/3.jpg)

**A self-hosted AWS multi-account access portal that runs on Cloudflare Workers.** Give your team a single place to sign into any AWS account, see which roles they can assume, track cloud spend, and manage access — all gated behind your existing Cloudflare Zero Trust identity provider.

**[→ Try the live demo](https://aws-access-bridge.220cbb9e01920558e6d2862ebf66b298.workers.dev/)** · [More screenshots](https://github.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge-Assets)

---

## Why AWS AccessBridge?

Managing IAM access across many AWS accounts is painful: engineers juggle IAM users per account, IAM Identity Center costs money to run, and nobody can say who may assume what without digging through five AWS services.

AWS AccessBridge is a pnpm monorepo deploying a Cloudflare Worker API, a cron Durable Object with a collection Workflow, and a Vite React SPA. It uses your Cloudflare Zero Trust login, stores AWS credentials encrypted in Cloudflare D1, and hands out short-lived session credentials on demand.

---

## Features

### Access & Role Assumption

- **One-click AWS Console sign-in** — pick an account and role, land in the Console with temporary credentials.
- **Programmatic credentials** — short-lived `access_key_id` / `secret_access_key` / `session_token` for the CLI or SDKs.
- **Federated sign-in** — one endpoint composing assume-role and the Console signin token in process.
- **Multi-hop role chains** — base IAM user → intermediate role → target role, up to your configured chain depth.
- **Per-user role visibility** — control which roles each user sees and can assume; users can hide the rest.
- **Account search** and **favorites** — server-side search across assumable accounts and roles; pin the most-used.
- **Personal access tokens** — scoped PATs for scripts and CI, stored as SHA-256 digests: a database read or backup cannot yield a working token. Migration `0034` invalidated every earlier token; users re-issue from the profile page.

### Team Workspaces

- Multi-tenant **teams** with `admin`/`member` roles recorded per member, and accounts associated per team.
- _(Membership is recorded and displayed, not enforced: which accounts a user sees is driven by per-user role grants plus superadmin. See [`docs/agents/features/teams/AGENTS.md`](./docs/agents/features/teams/AGENTS.md).)_

### Cost & Resource Insights

- **Cost dashboard** — spend by account with trend charts from AWS Cost Explorer.
- **Spend alerts** — per-account thresholds, stored in the admin tab. _(Stored only; no evaluator or notifier runs yet — see [`docs/agents/features/cost-analytics/AGENTS.md`](./docs/agents/features/cost-analytics/AGENTS.md).)_
- **Resource inventory** — paginated, filterable EC2 / S3 / Lambda / RDS / DynamoDB view across every connected account, refreshed in the background.
- **Per-account collection toggles** for cost and resource collection.

### Admin & Governance

- **Guided onboarding wizard** — a 6-step flow (Account → Credentials → Chain → Roles → Users → Summary) for the first account and first user grant.
- **Credential validation & chain testing** — verify credentials and simulate a full chain before granting access.
- **IAM role discovery** — pick assumable roles from a dropdown (needs `iam:ListRoles` on the assumed role; falls back to manual entry).
- **Account nicknames**, **role configs** (Console deep-link path, region, session duration 900–43200s; chained sessions capped at 3600s), and an **audit log viewer** with configurable retention.
- **Maintenance** — one-click purge of orphaned rows (collection configs, role configs, team accounts, spend alerts, cost data, resource inventory, AWS accounts), plus task-run visibility.
- **Language preferences** — 12-locale UI with per-user `preferredLanguage` (profile wins over browser detection).

### Security

- **Cloudflare Zero Trust** enforces identity at the edge — AccessBridge never handles passwords or OIDC. `POLICY_AUD`/`TEAM_DOMAIN` JWT verification is used when set; otherwise the platform-verified Worker-level Access identity (`ctx.access`) is used.
- **AES-GCM encryption** for stored AWS credentials, with a separate Secrets Store key per encrypted surface (long-term IAM keys, temporary-credential cache).
- **HMAC-signed internal requests** are accepted on the programmatic surface (1-second timestamp window, single-use replay guard). No component signs one today — federation composes in process — so this is the surface that _rejects_ a forged internal header rather than a path in use.
- **Every `/user/*` and `/api/*` call is audit-logged** automatically (`/docs` and `/openapi.json` sit outside those prefixes).
- **Demo mode** disables all admin write operations — safe for public demo deployments.

---

## Getting Started

Deployment has two halves: standing up the Cloudflare side (where the app lives) and configuring the AWS side (where the roles live). The in-app onboarding wizard handles most of the AWS-side work after the first deploy.

### Prerequisites

- **Cloudflare account** with Workers, Durable Objects, D1, KV, Secrets Store, and Zero Trust enabled
- **Node.js 24** (matching CI) and **pnpm 11.2.2** (`packageManager: pnpm@11.2.2`)
- **AWS account(s)** where you want to grant access
- Your own domain on Cloudflare (recommended, for Zero Trust-protected routes)

---

## Deployment Guide — Manual (Local)

Use this path the first time you deploy, or if you don't want GitHub Actions. All commands run from the project root.

### Step 1. Clone and install

```bash
git clone https://github.com/<your-username>/AWS-AccessBridge.git
cd AWS-AccessBridge
pnpm install
pnpm exec wrangler login
pnpm exec wrangler whoami   # verify the right account
```

### Step 2. Create the Cloudflare resources

AccessBridge needs one D1 database, one KV namespace, and one Secrets Store holding three secrets. The Durable Object namespace (`CRON_TASKS`), the Workflow (`COLLECTION_WORKFLOW`), the rate limiter (`AUTH_RATE_LIMITER`), and the `*/10 * * * *` cron trigger are created from `wrangler.jsonc` on deploy.

```bash
pnpm exec wrangler d1 create aws-access-bridge-db
pnpm exec wrangler kv namespace create aws-access-bridge-kv
pnpm exec wrangler secrets-store store create default --remote
```

Copy the D1 `database_id`, the KV `id`, and the store ID from the outputs. (The deploy script also accepts namespaces titled `aws-access-bridge-AccessBridgeKV` or `AccessBridgeKV`, and will find/create the store named `default` automatically.)

### Step 3. Create `wrangler.jsonc`

```bash
cp apps/api/wrangler.template.jsonc wrangler.jsonc
```

`wrangler.jsonc` is gitignored. (A second template, `apps/web/wrangler.template.jsonc`, is only used for the optional Pages deployment.) Replace every `0000…` placeholder:

- `d1_databases[0].database_id` → your D1 ID
- `kv_namespaces[0].id` → your KV ID
- Both `secrets_store_secrets[*].store_id` → your Secrets Store ID

Then generate and upload the three secrets in one go (the script reads the store IDs from `wrangler.jsonc`, so create it first):

```bash
pnpm exec tsx scripts/deploy/init-secrets.ts
```

The script creates any declared secret that does not yet exist, generating a strong value for each, and is a no-op on re-run. Each encrypted surface gets its own key: `aws-access-bridge-credential-encryption-key`, `aws-access-bridge-credential-cache-encryption-key`, and the HMAC secret `aws-access-bridge-internal-request-hmac-secret`. The former single `aws-access-bridge-aes-encryption-key` is no longer read, created, or required; delete it after deploying if your store still holds it.

To generate them by hand instead, run `openssl rand -base64 32 | pnpm exec wrangler secrets-store secret create <STORE_ID> --name <secret-name> --scopes workers --remote` once per secret name above.

**The plaintext `CREDENTIAL_ENCRYPTION_KEY` / `CREDENTIAL_CACHE_ENCRYPTION_KEY` vars are a local-development and test fallback only.** When `ENVIRONMENT` is `production` the worker refuses them and fails with `InternalServerError` rather than encrypting the IAM credentials table under a key that sits in an ordinary env var. If your deployment predates the Secrets Store and sets only those vars, **bind the two encryption secrets before deploying** or credential reads will start failing.

### Step 4. Wire up Cloudflare Zero Trust

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Access → Applications → Add an application → Self-hosted**.
2. Application name **AWS AccessBridge**, your worker's subdomain + domain, session duration (8 hours is a good default).
3. Create at least one **Access policy** — Action **Allow**, Include the emails / email domains / IdP groups that should be allowed in.
4. Save the application.

**If your worker and domain live in the same Cloudflare account** (the common case) **and you enable Worker-level Access on the worker** (Workers & Pages → your worker → Settings → Domains & Routes → Enable Cloudflare Access), you're done — AccessBridge uses the platform-verified identity (`ctx.access`) automatically. You do **not** need `POLICY_AUD` or `TEAM_DOMAIN`.

**Otherwise — self-hosted Access applications, or any cross-account setup** (e.g. serving a customer's domain via [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-saas/)) — the worker verifies the Access JWT itself, so set both vars explicitly:

1. Copy the **Application Audience (AUD) tag** from the Zero Trust application overview.
2. Note the owning account's **team domain** (e.g. `https://acme.cloudflareaccess.com`).
3. Add both to `wrangler.jsonc` (`"POLICY_AUD": "…"`, `"TEAM_DOMAIN": "https://…"` under `vars`).

When the vars are set they always take precedence; when unset, requests authenticate via the Worker-level Access identity.

### Step 5. Apply database migrations

```bash
pnpm exec wrangler d1 migrations apply --remote AccessBridgeDB
```

You should see `0030_squash.sql` apply cleanly, followed by `0031`–`0034`. `wrangler d1 migrations apply` skips files already applied, so re-running it is safe.

Once a migration has been applied, **do not edit it** — D1 records the filename, not the file's contents, so your change would never re-apply and production would keep the old schema. `migrations/migrations.lock.json` records a checksum per migration and CI fails on drift; after adding a migration, run `pnpm run migrations:lock`. The squashed baseline (`0030_squash.sql`) is exempt.

- `0031_distinct_credential_ivs.sql` — one AES-GCM IV per encrypted field (a shared IV leaks the XOR of the plaintexts and enables tag forgery). No backfill: existing rows read with the shared `salt` and upgrade to distinct IVs on their next write; KV cache entries simply expire.
- `0032_user_identity.sql` — `user_metadata.id` (`usr_<hex>`) becomes the stable account key, `current_email` the mutable sign-in address, and `user_emails` maps addresses to accounts; `user_email` stays as a frozen anchor because live foreign keys target it. Purely additive, and the code tolerates a database without it. Case-colliding accounts are deliberately left unresolved — find them with `SELECT user_email FROM user_metadata WHERE current_email IS NULL`.
- `0033_collection_attempt_timestamps.sql` — `data_collection_config.last_attempt_at` separates "last tried" from "last succeeded", so a failing principal no longer stays due and starves every batch; the backfill copies `last_collected_at` forward.

### Step 6. Build and deploy

```bash
pnpm --filter @aws-access-bridge/web run build
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler deploy
```

The web build embeds `dist/index.html` into the API worker (`apps/api/src/generated/spa-shell.ts`), so build the SPA first. (`pnpm run typegen` regenerates `worker-configuration.d.ts` after binding changes; it also runs via `postinstall`.) When it succeeds, wrangler prints the deployed URL — visit it and you should hit Zero Trust first, then land in AccessBridge.

### Step 7. Bootstrap the first superadmin

The first user to sign in is a normal user — promote yourself once:

```bash
pnpm exec wrangler d1 execute aws-access-bridge-db --remote --command \
  "INSERT INTO user_metadata (user_email, is_superadmin) VALUES ('you@example.com', 1) \
   ON CONFLICT(user_email) DO UPDATE SET is_superadmin = 1;"
```

Refresh the app and the **Admin** tab appears. Open **Setup Wizard** for guided onboarding of your first AWS account.

---

## Deployment Guide — GitHub Actions (CI/CD)

Deployment runs after CI succeeds on `main` (the recommended path for forks), and can also be triggered from **Actions → Continuous Deployment → Run workflow** or via `repository_dispatch`.

### One-time setup for your fork

1. **Fork the repository** and **run Steps 1–5 of the manual guide once locally** — you need a working `wrangler.jsonc` to continue.
2. **Create a Cloudflare API token** ([dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)) with: Account → Workers Scripts **Edit**, Workers KV Storage **Edit**, D1 **Edit**, Cloudflare Secrets Store **Edit**, Cloudflare Pages **Edit** (only for the Pages job), and Zone → Workers Routes **Edit** (only for custom routes).
3. **Add GitHub Secrets** (`Settings → Secrets and variables → Actions → Secrets`): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Add a GitHub Variable**: `WRANGLER_JSONC` — paste the **entire contents** of your local `wrangler.jsonc`. If empty, the workflow falls back to `apps/api/wrangler.template.jsonc` and provisions the resources itself. (The workflow writes it out at the start of each run, since the file is gitignored.)
5. **Push to `main`.** Once CI passes, the deployment prepares the config via `scripts/deploy/prepare-wrangler-config.ts` (apply `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON`, check it carries every binding and var the template declares, fill `000…` placeholder IDs, provision missing resources), initializes missing secrets, applies pending migrations, builds the SPA, hides stray OpenNext/Next.js config files (defensive — wrangler would otherwise delegate to the OpenNext build), then runs `wrangler deploy --dry-run` and `wrangler deploy`, retrying each deploy step up to 3 attempts.

A second job, `deploy-pages`, builds the SPA and deploys it to Cloudflare Pages with the `API_WORKER` service binding (from `apps/web/wrangler.template.jsonc`), defaulting to `aws-access-bridge-web` when the `CLOUDFLARE_PAGES_PROJECT_NAME` variable is unset.

### Keeping `WRANGLER_JSONC` up to date

The template evolves, so an older `WRANGLER_JSONC` can fall behind. `prepare-wrangler-config.ts` refuses to deploy a config that omits any binding or var the template declares and names every gap. If CI reports a coverage error, diff your variable against `apps/api/wrangler.template.jsonc` and resync — or supply the missing vars through `WRANGLER_VARS_PATCH_JSON`. KV namespaces are excluded (they are injected automatically when missing), and `ratelimits` / `workflows` blocks are not covered at all, so keep those in sync yourself.

Deployment variables: `WRANGLER_PATCH_JSON` (JSON object merged into the **top level** of `wrangler.jsonc` — routes, placement) and `WRANGLER_VARS_PATCH_JSON` (string values merged into top-level **`vars`** — e.g. `POLICY_AUD`, `TEAM_DOMAIN`). Do not put secrets in either; use GitHub secrets or Cloudflare Secrets Store.

### Database backups (optional)

A `Backup D1 Database` workflow exports `AccessBridgeDB` daily at 04:15 UTC to S3-compatible storage and/or WebDAV. Off until you configure a destination. Requires `BACKUP_ENCRYPTION_KEY` (**required** — the export carries addresses, audit rows and encrypted credentials) plus destination secrets: `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` and/or `WEBDAV_URL` / `WEBDAV_USER` / `WEBDAV_PASSWORD`; optional `S3_ENDPOINT`, `S3_REGION`, `BACKUP_RETENTION_DAYS`, `WEBDAV_BASE_PATH`, `WEBDAV_VENDOR`. Run it once from the Actions tab to enable the schedule, and store backups **outside** your Cloudflare account. Full setup, restore, and Time Travel instructions: **[Database Backup, Restore, and Time Travel](./docs/db-backup-recovery.md)**.

---

## AWS IAM Setup (Recommended: Intermediate-Role Pattern)

Have AccessBridge assume an intermediate role instead of giving its base IAM user broad permissions. The onboarding wizard nudges you toward this pattern.

**1. Base IAM user:**

```
Name: DO-NOT-DELETE-Federated-SSO-AccessBridge
Permissions (inline policy):
  sts:AssumeRole → arn:aws:iam::<account>:role/DO-NOT-DELETE-AccessBridge-Intermediate
```

Generate an access key pair and paste it into AccessBridge (Admin → Credentials, or the Setup Wizard).

**2. Intermediate role** — trusted by the user above, with permission to assume target roles:

```
Name: DO-NOT-DELETE-AccessBridge-Intermediate
Trust policy: allow the base IAM user to AssumeRole
Permission policy:
  sts:AssumeRole → arn:aws:iam::<account>:role/*
```

**3. Target roles** — for every role your team uses, let the intermediate role assume it:

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<account>:role/DO-NOT-DELETE-AccessBridge-Intermediate" },
  "Action": "sts:AssumeRole"
}
```

**Why bother?** The long-lived user can only call `AssumeRole` on the intermediate (small blast radius); every access shows up in CloudTrail as intermediate → target; and existing target roles trust one principal rather than a user or an external SSO principal.

---

## Running the Onboarding Wizard

Open the app → **Admin → Setup Wizard**. The 6 steps are:

| Step           | What you do                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| 1. Account     | Enter an AWS account ID and a friendly nickname.                              |
| 2. Credentials | Paste the base IAM user access key + secret.                                  |
| 3. Chain       | Optionally add the intermediate role ARN. Test the full chain before saving.  |
| 4. Roles       | The app lists IAM roles in the account — pick which ones should be assumable. |
| 5. Users       | Grant specific users access to specific roles.                                |
| 6. Summary     | Review everything and commit.                                                 |

After the first account, repeat for additional accounts from the same Admin panel, or use the admin tabs directly.

---

## Environment Variables

All of these live in `wrangler.jsonc` under `vars`. Defaults come from `packages/backend-runtime/src/config/ConfigurationDefaults.ts` and are read via `ConfigurationManager` namespaces.

| Variable                                          | Purpose                                                                                                                                           | Default         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `POLICY_AUD`                                      | Zero Trust Application Audience tag. **Optional when Worker-level Access is enabled**; required for self-hosted or cross-account setups.          | —               |
| `TEAM_DOMAIN`                                     | Zero Trust team domain. **Optional** — same conditions as `POLICY_AUD`.                                                                           | —               |
| `MAX_TOKENS_PER_USER`                             | How many active Personal Access Tokens a user can hold.                                                                                           | `5`             |
| `MAX_TOKEN_EXPIRY_DAYS`                           | Max expiry a user can set on a PAT.                                                                                                               | `90`            |
| `PRINCIPAL_TRUST_CHAIN_LIMIT`                     | Max depth of role assumption chain. A chain past the boundary hop is refused; entries cached under a higher limit age out with their credentials. | `3`             |
| `AUDIT_LOG_RETENTION_DAYS`                        | How long to keep audit log entries.                                                                                                               | `90`            |
| `BACKGROUND_TASK_RUN_RETENTION_DAYS`              | How long to keep background task-run records.                                                                                                     | `30`            |
| `PRUNE_BATCH_SIZE`                                | Rows deleted per prune batch.                                                                                                                     | `500`           |
| `NUMBER_OF_CREDENTIALS_TO_REFRESH`                | Max cached credentials refreshed per cycle.                                                                                                       | `10`            |
| `CREDENTIAL_REFRESH_INTERVAL_MINUTES`             | Background refresh interval for stale cached credentials.                                                                                         | `45`            |
| `COST_COLLECTION_INTERVAL_HOURS`                  | Background Cost Explorer collection interval.                                                                                                     | `6`             |
| `COST_LOOKBACK_DAYS`                              | Days of cost history fetched per collection.                                                                                                      | `30`            |
| `RESOURCE_COLLECTION_INTERVAL_HOURS`              | Background resource inventory collection interval.                                                                                                | `2`             |
| `INVENTORY_REGIONS`                               | Comma-separated AWS regions the resource inventory sweeps. Empty falls back to the built-in commercial-region list; S3 is global and ignores it.  | `""`            |
| `INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS` | HMAC timestamp replay window for internal calls.                                                                                                  | `1000`          |
| `DEMO_MODE`                                       | When `"true"`, all admin write operations are blocked.                                                                                            | `"false"`       |
| `LOG_LEVEL`                                       | `debug`\|`info`\|`warn`\|`error` for the request path; an unrecognised value clears the filter. Not installed on the cron/Durable Object path.    | `info`          |
| `ENVIRONMENT`                                     | Only the literal `"production"` arms the `DEV_AUTH_EMAIL` guard and refuses the plaintext encryption vars. Set it on every real deployment.       | `"development"` |
| `DEV_AUTH_EMAIL`                                  | Local-only auth bypass. **Refused** when `ENVIRONMENT` is `"production"`.                                                                         | —               |

---

## Verifying the Deploy

```bash
curl -I https://<your-worker-url>/        # worker responds (Zero Trust first unless signed in)
pnpm exec wrangler tail                   # watch for errors
open https://<your-worker-url>/docs       # OpenAPI docs render

# Locally, drive a scheduled event by hand:
pnpm exec wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*%2F10+*+*+*+*"
```

## Troubleshooting

- **"Unauthorized" on every request** — for a self-hosted Access application or cross-account setup, make sure `POLICY_AUD` and `TEAM_DOMAIN` are set and match the owning account's Zero Trust application; for Worker-level Access, make sure it is enabled on the worker.
- **Admin tab is missing** — you haven't been promoted to superadmin yet. See Step 7.
- **CI fails with "is missing bindings and vars that … requires"** — your `WRANGLER_JSONC` variable predates a binding or var the template now declares. The error lists every missing key; resync it or add the missing vars to `WRANGLER_VARS_PATCH_JSON`.
- **`wrangler deploy` OOMs in CI** — the workflow hides stray `open-next.config.ts` / `next.config.ts` files before deploying so wrangler doesn't delegate to the OpenNext build (defensive; the repo ships neither).
- **Credentials cached forever after rotating an IAM key** — cached credentials refresh once stale per `CREDENTIAL_REFRESH_INTERVAL_MINUTES` (default 45), so a rotation takes up to that long. There is no production trigger; the pipeline runs only from Cloudflare's `triggers.crons`.

---

## Running Locally

```bash
pnpm --filter @aws-access-bridge/web run dev        # Vite dev server (proxies /api + /user → localhost:8787)
pnpm exec wrangler dev --config ./wrangler.jsonc    # Local Workers runtime for the backend
```

Useful scripts (see root `package.json`):

| Command                                             | What it does                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm run checks`                                   | The full gate: fast checks, then coverage, floors, and integration       |
| `pnpm run typecheck`                                | Type-check every workspace, plus `scripts/**` and `functions/**`         |
| `pnpm run lint` / `pnpm run prettier`               | ESLint autofix / Prettier format                                         |
| `pnpm run test` / `test:coverage`                   | Vitest, optionally with coverage                                         |
| `pnpm run check:coverage-floor`                     | Per-file coverage floors for the 34 load-bearing files                   |
| `pnpm run test:integration` / `test:floci`          | Workers integration suite / AWS parser smoke tests (needs the container) |
| `pnpm run validate:migrations` / `validate:locales` | Migration checksum lock / 12 web locale bundles                          |
| `pnpm --filter @aws-access-bridge/web run build`    | Build the SPA with Vite (also embeds it into the API worker)             |
| `pnpm run verify:spa-shell`                         | Check the embedded shell is a real build, not the postinstall stub       |
| `pnpm run typegen`                                  | Regenerate `worker-configuration.d.ts` from the API template             |

---

## Documentation

- **[`AGENTS.md`](./AGENTS.md)** — the agent/contributor index: [`docs/agents/repo`](./docs/agents/repo/AGENTS.md) (workspace, commands, gates), [`docs/agents/runtime`](./docs/agents/runtime/AGENTS.md) (bindings, env vars, migrations, backups), [`docs/agents/testing`](./docs/agents/testing/AGENTS.md) (the suite and its thresholds), one per app ([`api`](./apps/api/AGENTS.md), [`web`](./apps/web/AGENTS.md), [`background`](./apps/background/AGENTS.md)) and package ([`backend-data`](./packages/backend-data/AGENTS.md), [`backend-services`](./packages/backend-services/AGENTS.md)), and one per feature under [`docs/agents/features/`](./docs/agents/features/) (assume-role, credential chains, cost analytics, resource inventory, teams, user identity).
- **[Database Backup, Restore, and Time Travel](./docs/db-backup-recovery.md)** — the daily D1 backup workflow, its secrets, and how to get your data back.
- **OpenAPI docs** — the running worker serves interactive API docs at **`/docs`**.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Make changes, add tests, and run `pnpm run checks`. Build the SPA before shipping UI changes.
3. Open a pull request.

## License

[MIT](./LICENSE)

## Support

For issues, questions, or contributions, please visit the [GitHub repository](https://github.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge).
