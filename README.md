# AWS AccessBridge

![Accounts Page Preview](https://raw.githubusercontent.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge-Assets/refs/heads/main/pictures/3.jpg)

**A self-hosted AWS multi-account access portal that runs on Cloudflare Workers.** Give your team a single place to sign into any AWS account, see which roles they can assume, track cloud spend, and manage access — all gated behind your existing Cloudflare Zero Trust identity provider.

**[→ Try the live demo](https://aws-access-bridge.220cbb9e01920558e6d2862ebf66b298.workers.dev/)**

---

## Why AWS AccessBridge?

Managing IAM access across many AWS accounts is painful:

- You want engineers to sign in with **one identity** (Google, Okta, GitHub, etc.) instead of juggling IAM users per account.
- You don't want to pay for or operate AWS IAM Identity Center.
- You want **fine-grained control** over which person can see which role in which account.
- You want **visibility** into cost, resources, and who-did-what — without wiring up five different AWS services.

AWS AccessBridge is a single Cloudflare Worker that gives your team a web UI for exactly that. It uses your Cloudflare Zero Trust login, stores AWS credentials encrypted in Cloudflare D1, and hands out short-lived session credentials on demand.

---

## Features

### Access & Role Assumption

- **One-click AWS Console sign-in** — pick an account, pick a role, land in the Console with temporary credentials.
- **Programmatic credentials** — get short-lived `access_key_id` / `secret_access_key` / `session_token` for the CLI or SDKs.
- **Multi-hop role chains** — chain credentials across accounts (base IAM user → intermediate role → target role) up to your configured chain depth.
- **Per-user role visibility** — control exactly which roles each user can see and assume, and let users hide roles they don't want cluttering their view.
- **Favorites** — users can pin their most-used accounts to the top.
- **Personal access tokens** — users can mint scoped PATs for use in scripts and CI.

### Team Workspaces

- Multi-tenant **teams** with admin/member roles.
- Scope AWS accounts to specific teams so only team members see them.
- Per-team admin controls for member and account membership.

### Cost & Resource Insights

- **Cost dashboard** — daily/weekly/monthly spend by account, trend charts, and total-spend cards powered by AWS Cost Explorer.
- **Spend alerts** — configurable thresholds that notify when an account crosses a dollar limit.
- **Resource inventory** — paginated, filterable view of EC2 instances, S3 buckets, Lambda functions, and RDS databases across every connected account, refreshed in the background.

### Admin & Governance

- **Guided onboarding wizard** — a 6-step in-app flow (Account → Credentials → Chain → Roles → Users → Summary) that walks a new admin through their first account and first user grant.
- **Credential validation & chain testing** — verify credentials and simulate a full assumption chain before you grant access.
- **IAM role discovery** — list all IAM roles in a connected account so you can pick assumable ones from a dropdown instead of typing ARNs.
- **Account nicknames** — give AWS account IDs human-friendly names.
- **Role configs** — per-role default Console deep-link path and region.
- **Audit log viewer** — filterable, paginated view of every API action taken through AccessBridge, with configurable retention.
- **Maintenance** — one-click purge of orphaned rows in satellite tables (cost data, spend alerts, resource inventory, role configs, team memberships) left behind when an account or credential is removed.

### Security

- **Cloudflare Zero Trust** enforces identity at the edge — AccessBridge never handles passwords or OIDC directly.
- **AES-GCM encryption** for all stored AWS credentials, with the key held in Cloudflare Secrets Store.
- **HMAC-signed internal requests** between worker components, with a 1-second timestamp window to block replay.
- **Every API call is audit-logged** automatically and retained for the period you configure.
- **Demo mode** flag disables all admin write operations — safe for public demo deployments.

---

## Getting Started

Deployment has two halves: standing up the Cloudflare side (where the app lives), and configuring the AWS side (where the roles live). The in-app onboarding wizard handles most of the AWS-side work after the first deploy.

### Prerequisites

- **Cloudflare account** with Workers, Durable Objects, D1, KV, Secrets Store, and Zero Trust enabled
- **Node.js 18+** (CI uses Node 24)
- **AWS account(s)** where you want to grant access
- Your own domain on Cloudflare (recommended, for Zero Trust-protected routes)

---

## Deployment Guide — Manual (Local)

Use this path the first time you deploy, or if you don't want to use GitHub Actions. All commands are run from the project root.

### Step 1. Clone and install

```bash
git clone https://github.com/<your-username>/AWS-AccessBridge.git
cd AWS-AccessBridge
npm install
npx wrangler login
```

Verify you're authenticated with the right account:

```bash
npx wrangler whoami
```

### Step 2. Create the Cloudflare resources

AccessBridge needs one D1 database, one KV namespace, and one Secrets Store with two secrets inside it. The Durable Object namespace for cron processing is created automatically from `wrangler.jsonc` on deploy.

**D1 database:**

```bash
npx wrangler d1 create aws-access-bridge-db
```

Copy the `database_id` from the output.

**KV namespace (for credential cache):**

```bash
npx wrangler kv namespace create AccessBridgeKV
```

Copy the `id` from the output.

**Secrets Store + two secrets:**

```bash
npx wrangler secrets-store store create aws-access-bridge-secrets
```

Copy the store ID. You can generate the two secret values automatically by running the project's setup script (recommended) — see Step 3.

### Step 3. Create `wrangler.jsonc`

Copy the template and fill in the IDs from Step 2:

```bash
cp wrangler.jsonc.template wrangler.jsonc
```

Open `wrangler.jsonc` and replace every placeholder (the `0000…` strings) with the real IDs:

- `d1_databases[0].database_id` → your D1 ID
- `kv_namespaces[0].id` → your KV ID
- Both `secrets_store_secrets[*].store_id` → your Secrets Store ID

Then generate and upload the two secrets in one go:

```bash
npx tsx scripts/init-secrets.ts
```

This script reads `wrangler.jsonc`, detects the two expected secrets (`aws-access-bridge-aes-encryption-key`, `aws-access-bridge-internal-hmac-secret`), generates cryptographically strong values for each, and uploads them to the store. Re-running it is a no-op — it skips any secret that already exists.

If you'd rather generate the secrets yourself:

```bash
# AES-GCM 256-bit key (base64)
openssl rand -base64 32 | npx wrangler secrets-store secret create <STORE_ID> \
  --name aws-access-bridge-aes-encryption-key --scopes workers --remote

# HMAC secret (base64)
openssl rand -base64 32 | npx wrangler secrets-store secret create <STORE_ID> \
  --name aws-access-bridge-internal-hmac-secret --scopes workers --remote
```

### Step 4. Wire up Cloudflare Zero Trust

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Access → Applications → Add an application → Self-hosted**.
2. Fill in:
   - **Application name**: AWS AccessBridge
   - **Subdomain + domain**: whatever URL your worker will live at
   - **Session duration**: 8 hours is a good default
3. On the next screen, create at least one **Access policy**:
   - **Action**: Allow
   - **Include**: the emails, email domains, or IdP groups that should be allowed in.
4. Save the application.

**If your worker and your domain live in the same Cloudflare account** (the common case), you're done — AccessBridge infers the Zero Trust team and application audience automatically at runtime. You do **not** need to set `POLICY_AUD` or `TEAM_DOMAIN`.

**If your worker lives in a different Cloudflare account from the domain owner** (e.g. you're serving a customer's domain via [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-saas/)), the worker can't infer the owning account's Zero Trust config, so you must set both explicitly:

1. On the Zero Trust application overview, copy the **Application Audience (AUD) tag**.
2. Note the owning account's **team domain** (e.g. `https://acme.cloudflareaccess.com`).
3. Add both to `wrangler.jsonc`:

   ```jsonc
   "vars": {
     "POLICY_AUD": "abcdef…the AUD tag…",
     "TEAM_DOMAIN": "https://acme.cloudflareaccess.com",
     // ...
   }
   ```

### Step 5. Apply database migrations

```bash
npx wrangler d1 migrations apply --remote aws-access-bridge-db
```

You should see the squashed migration file apply cleanly. Re-running is safe.

### Step 6. Build and deploy

```bash
npm run deploy
```

`npm run deploy` chains: prettier → lint → `vite build` → `wrangler deploy --dry-run` → `wrangler deploy`. If anything fails, nothing is deployed.

When it succeeds, wrangler prints the deployed URL (either `*.workers.dev` or your custom route). Visit it — you should hit Cloudflare Zero Trust first, then land in AccessBridge.

### Step 7. Bootstrap the first superadmin

The first user to sign in is just a normal user — you need to promote yourself once:

```bash
npx wrangler d1 execute aws-access-bridge-db --remote --command \
  "INSERT INTO user_metadata (user_email, is_superadmin) VALUES ('you@example.com', 1) \
   ON CONFLICT(user_email) DO UPDATE SET is_superadmin = 1;"
```

Refresh the app and you'll see the **Admin** tab appear. From there, open **Setup Wizard** for the guided onboarding of your first AWS account.

---

## Deployment Guide — GitHub Actions (CI/CD)

The repo ships with a deploy workflow at `.github/workflows/deploy-cloudflare-worker.yml` that runs on every push to `main`. This is the recommended path for forks — push to your fork's main and your worker redeploys automatically.

### One-time setup for your fork

1. **Fork the repository** on GitHub.

2. **Run Steps 1–5 of the manual guide once locally** (clone, install, create Cloudflare resources, set up Zero Trust, apply migrations). You need a working `wrangler.jsonc` to continue.

3. **Create a Cloudflare API token** with these permissions:
   - Account → Workers Scripts: Edit
   - Account → Workers KV Storage: Edit
   - Account → D1: Edit
   - Account → Cloudflare Secrets Store: Edit
   - Zone → Workers Routes: Edit (only if using custom routes)

   [Create API token](https://dash.cloudflare.com/profile/api-tokens).

4. **Add GitHub Secrets** to your fork (`Settings → Secrets and variables → Actions → Secrets`):
   - `CLOUDFLARE_API_TOKEN` — the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

5. **Add a GitHub Variable** (not a secret — `Settings → Secrets and variables → Actions → Variables`):
   - `WRANGLER_JSONC` — paste the **entire contents** of your local `wrangler.jsonc` here.

   The workflow writes this out to `wrangler.jsonc` at the start of each run (since `wrangler.jsonc` itself is gitignored).

6. **Push to `main`**. The `Deploy Cloudflare Worker` workflow kicks off automatically and will:
   - Validate that `WRANGLER_JSONC`'s `$version` is at least the template's `$minimumVersion`
   - Initialize any missing secrets via `scripts/init-secrets.ts`
   - Apply pending D1 migrations to your remote database
   - Build the Vite SPA
   - Hide the OpenNext config files (so wrangler doesn't OOM trying to build the Next.js path on the CI runner)
   - Run `wrangler deploy`

You can also trigger the workflow manually via **Actions → Deploy Cloudflare Worker → Run workflow**.

### Keeping `WRANGLER_JSONC` up to date

The template evolves (new bindings, new vars). If CI fails with a "version below minimum" error, update the `$version` and any new fields in your `WRANGLER_JSONC` GitHub variable to match the latest `wrangler.jsonc.template`.

---

## AWS IAM Setup (Recommended: Intermediate-Role Pattern)

For the best security posture, have AccessBridge assume an intermediate role instead of giving its base IAM user broad permissions. The onboarding wizard nudges you toward this pattern, but here's the full picture.

### 1. Base IAM user

Create an IAM user with permission to assume **only** the intermediate role:

```
Name: DO-NOT-DELETE-Federated-SSO-AccessBridge
Permissions (inline policy):
  sts:AssumeRole → arn:aws:iam::<account>:role/DO-NOT-DELETE-AccessBridge-Intermediate
```

Generate an access key pair for this user and paste it into AccessBridge (Admin → Credentials, or via the Setup Wizard).

### 2. Intermediate role

Create a role trusted by the user above, with permission to assume target roles:

```
Name: DO-NOT-DELETE-AccessBridge-Intermediate
Trust policy: allow the base IAM user to AssumeRole
Permission policy:
  sts:AssumeRole → arn:aws:iam::<account>:role/*
```

### 3. Target roles

For every role your team actually uses, update the trust policy to allow the intermediate role:

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<account>:role/DO-NOT-DELETE-AccessBridge-Intermediate" },
  "Action": "sts:AssumeRole"
}
```

### Why bother with the intermediate role?

- **Small blast radius** — the long-lived IAM user can only do one thing: call `AssumeRole` on the intermediate.
- **Clean audit trail** — every access shows up in CloudTrail as intermediate → target.
- **One principal to trust** — existing target roles only need to trust the intermediate role, not a user or an external SSO principal.

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

After the first account, you can repeat for additional accounts from the same Admin panel, or use the rest of the admin tabs directly without the wizard.

---

## Environment Variables

All of these live in `wrangler.jsonc` under `vars`.

| Variable                      | Purpose                                                                                                                                                                           | Default   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `POLICY_AUD`                  | Zero Trust Application Audience tag. **Optional** — only required when the worker and domain are in different Cloudflare accounts (Cloudflare for SaaS). Auto-inferred otherwise. | —         |
| `TEAM_DOMAIN`                 | Zero Trust team domain (e.g. `https://acme.cloudflareaccess.com`). **Optional** — same conditions as `POLICY_AUD`.                                                                | —         |
| `MAX_TOKENS_PER_USER`         | How many active Personal Access Tokens a user can hold.                                                                                                                           | `5`       |
| `MAX_TOKEN_EXPIRY_DAYS`       | Max expiry a user can set on a PAT.                                                                                                                                               | `90`      |
| `PRINCIPAL_TRUST_CHAIN_LIMIT` | Max depth of role assumption chain.                                                                                                                                               | `3`       |
| `AUDIT_LOG_RETENTION_DAYS`    | How long to keep audit log entries.                                                                                                                                               | `90`      |
| `DEMO_MODE`                   | When `"true"`, all admin write operations are blocked. Safe for public demos.                                                                                                     | `"false"` |

---

## Verifying the Deploy

After the first deploy, a few quick health checks:

```bash
# Does the worker respond? (You'll hit Zero Trust unless you're signed in.)
curl -I https://<your-worker-url>/

# Are there any errors in the worker log tail?
npx wrangler tail

# Is the scheduled handler delegating to the cron Durable Object?
curl "https://<your-worker-url>/__scheduled?cron=*/10+*+*+*+*"

# Is the OpenAPI doc rendering?
open https://<your-worker-url>/docs
```

## Troubleshooting

- **"Unauthorized" on every request** — if your worker and domain are in different Cloudflare accounts (Cloudflare for SaaS), make sure `POLICY_AUD` and `TEAM_DOMAIN` are set and match the owning account's Zero Trust application. If they're in the same account, these vars should be unset so auto-inference kicks in.
- **Admin tab is missing** — you haven't been promoted to superadmin yet. See Step 7 of the manual guide.
- **CI fails with "version below minimum"** — your `WRANGLER_JSONC` GitHub variable is stale. Diff it against `wrangler.jsonc.template` and bump the `$version` field.
- **`wrangler deploy` OOMs in CI** — make sure the workflow's "Prepare for Deploy" step is hiding `open-next.config.ts` and `next.config.ts`. Without that, wrangler delegates to the OpenNext Next.js build which needs 2GB+ RAM.
- **Credentials cached forever after rotating an IAM key** — the credential cache refresh task runs every 10 minutes inside the cron Durable Object. You can force it via `GET /__scheduled?cron=*/10+*+*+*+*`.

---

## Screenshots

![Account list](https://raw.githubusercontent.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge-Assets/refs/heads/main/pictures/3.jpg)

_(More screenshots in the [assets repo](https://github.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge-Assets).)_

---

## Running Locally

```bash
npm run dev          # Vite dev server for the frontend
npx wrangler dev     # Local Cloudflare Workers runtime for the backend
```

Useful scripts:

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `npm run build`    | Format, lint, and build the SPA with Vite               |
| `npm run deploy`   | Build + `wrangler deploy --dry-run` + `wrangler deploy` |
| `npm run test`     | Run the vitest test suite                               |
| `npm run tsc`      | Type-check frontend and backend tsconfigs               |
| `npm run lint`     | ESLint autofix                                          |
| `npm run prettier` | Prettier format                                         |

---

## Documentation

- **[`AGENTS.md`](./AGENTS.md)** — architecture, endpoint inventory, database layout, scheduled tasks, and everything else an LLM agent or new contributor needs to navigate the codebase.
- **OpenAPI docs** — the running worker serves interactive API docs at **`/docs`**.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Make changes, add tests, and run `npm run build` (runs prettier + lint + Vite build). Use `npm run deploy` to also dry-run wrangler before shipping.
3. Open a pull request.

## License

[MIT](./LICENSE)

## Support

For issues, questions, or contributions, please visit the [GitHub repository](https://github.com/Rexezuge/AWS-AccessBridge).
