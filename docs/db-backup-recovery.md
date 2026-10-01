# Database Backup, Restore, and Time Travel

Operational playbooks for the AccessBridge D1 database: backup automation, restore flows, and point-in-time recovery.

> [!NOTE]
> Backups run from GitHub Actions, so the repository you deploy from must already have the Cloudflare secrets in place: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — the same pair the [Continuous Deployment](../README.md#deployment-guide--github-actions-cicd) workflow uses. A token with `Account → D1: Edit` can do both jobs.

## GitHub Actions Backups

`.github/workflows/backup-d1.yml` exports `AccessBridgeDB` daily at **04:15 UTC** and uploads the encrypted dump to one or more destinations (S3-compatible storage and/or WebDAV). Both destinations are optional; enable either, or both.

The run is split into four jobs so a broken destination never blocks the other:

| Job             | Runs when                                   | What it does                                                     |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `check-secrets` | always                                      | Detects configured secrets; fails the run on an incomplete setup |
| `export-d1`     | Cloudflare credentials + encryption key set | Resolves the config, exports D1, compresses, encrypts            |
| `backup-s3`     | S3 secrets set                              | Uploads to S3 and prunes backups past the retention window       |
| `backup-webdav` | WebDAV secrets set                          | Uploads via rclone and prunes backups past the retention window  |

> [!IMPORTANT]
>
> - **Encryption is required, not optional.** `AccessBridgeDB` stores `user_access_tokens.access_token` in plaintext — bearer tokens for the `/api/*` routes are matched against that column directly — along with `user_metadata` email addresses, audit logs, and team membership. An unencrypted dump is a live credential leak, so the workflow refuses to run without `BACKUP_ENCRYPTION_KEY`. See [What a backup contains](#what-a-backup-contains).
> - **Manual trigger required for the first run:** scheduled workflows only start after you run the workflow once from the Actions tab (GitHub → Actions → Backup D1 Database → Run workflow).
> - **Keep backups off this Cloudflare account.** The Worker, its D1 database, and the Secrets Store holding the IAM encryption key all live in one account. Storing backups in R2 in that _same_ account means a single suspension or ban takes down production and recovery alike. Use a different S3-compatible provider (AWS S3, Backblaze B2, MinIO) or a separate Cloudflare account.
> - **If you configure no destination at all, every backup job skips silently.** That is the intended state for a repository that does not want off-site backups — not a failure.

### Backup destination secrets

Add these to your fork (`Settings → Secrets and variables → Actions`).

#### Cloudflare (required)

These already exist for Continuous Deployment; the same values work here.

| Secret                  | Required | Description                                                  |
| ----------------------- | -------- | ------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | yes      | Token with `Account → D1: Edit` (deploy and backup share it) |
| `CLOUDFLARE_ACCOUNT_ID` | yes      | Your Cloudflare account ID                                   |

#### Encryption (required)

| Secret                  | Required | Description                                                                                                |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `BACKUP_ENCRYPTION_KEY` | yes      | Passphrase for AES-256-CBC (PBKDF2, 100k iterations). Losing it makes every backup permanently unreadable. |

#### S3-compatible storage (optional)

| Secret                 | Required     | Description                                                                                                                                  |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ACCESS_KEY_ID`     | yes (for S3) | S3 access key ID                                                                                                                             |
| `S3_SECRET_ACCESS_KEY` | yes (for S3) | S3 secret access key                                                                                                                         |
| `S3_BUCKET`            | yes (for S3) | Bucket name                                                                                                                                  |
| `S3_REGION`            | no           | Defaults to `auto`, which is what R2 expects. Set it only for providers that need a concrete region (Backblaze B2: `us-west-000`, Wasabi, …) |
| `S3_ENDPOINT`          | no           | Custom endpoint URL. Required for S3-compatible services (MinIO, R2, Backblaze B2)                                                           |

Keep the bucket private. The workflow uploads with the `aws s3 cp` CLI, so bucket policy must allow `PutObject` and `DeleteObject` for the configured key.

#### WebDAV (optional)

| Secret             | Required         | Description                                                                       |
| ------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `WEBDAV_URL`       | yes (for WebDAV) | Endpoint URL (e.g. Nextcloud: `https://example.com/remote.php/dav/files/<user>/`) |
| `WEBDAV_USER`      | yes (for WebDAV) | Username                                                                          |
| `WEBDAV_PASSWORD`  | yes (for WebDAV) | Password                                                                          |
| `WEBDAV_VENDOR`    | no               | rclone vendor (`nextcloud`, `owncloud`, `other`). Defaults to `other`             |
| `WEBDAV_BASE_PATH` | no               | Base path for backups on the remote. Defaults to `aws-access-bridge`              |

#### Common (optional)

| Secret                  | Required | Description                          |
| ----------------------- | -------- | ------------------------------------ |
| `BACKUP_RETENTION_DAYS` | no       | Days to keep backups. Defaults to 30 |

> [!WARNING]
> **GitHub automatically disables scheduled workflows after 60 days of repository inactivity.** If your fork receives no commits to the default branch for 60 days, the backup workflow (and every other cron-triggered workflow) is disabled, and you get an email beforehand. Periodically [sync with upstream](https://github.com/Rexezuge-CloudflareWorkers/AWS-AccessBridge) or re-enable it from the Actions tab. See [GitHub docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

### Backup features

- **Automatic daily backups** at 04:15 UTC, with a `check-secrets` preflight so misconfiguration fails fast with a named missing secret.
- **Manual trigger** from the Actions tab — same code path, useful before a risky migration.
- **Same database as the deploy.** The export job runs `scripts/prepare-wrangler-config.ts` exactly like Continuous Deployment, honoring `WRANGLER_JSONC`, `WRANGLER_PATCH_JSON`, and `WRANGLER_VARS_PATCH_JSON`. Whatever `AccessBridgeDB` resolves to at deploy time is what gets exported.
- **Compression then encryption:** gzip, then AES-256-CBC (PBKDF2, 100k iterations, random salt).
- **No plaintext ever leaves the job.** The unencrypted SQL is deleted before the artifact is stored, and only the `.enc` file is handed to the upload jobs.
- **Automatic cleanup** past `BACKUP_RETENTION_DAYS` in each destination. The S3 prune only ever deletes `*.sql.gz` / `*.sql.gz.enc` inside the `aws-access-bridge/production/` prefix.
- **Empty-database guard:** if `prepare-wrangler-config.ts` had to create the D1 database, the `database_id` is still the template placeholder and the run aborts rather than uploading an empty dump as a "backup".

### Where the logic lives

The workflow is only a job graph; each step delegates to a script in `scripts/backup/`, so the rules are testable without running Actions:

| Script                           | Step                           | Notes                                                                         |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `evaluate-destination-config.ts` | Detect Configured Destinations | Decides which jobs run; holds the fail-closed encryption policy               |
| `resolve-d1-target.ts`           | Resolve D1 Database            | Reads `wrangler.jsonc` with `jsonc-parser`; enforces the empty-database guard |
| `encrypt-backup.ts`              | Compress And Encrypt Backup    | Refuses to run without `BACKUP_ENCRYPTION_KEY`; deletes the plaintext         |
| `upload-s3.ts`                   | Upload To S3                   | Upload, then prune only `*.sql.gz[.enc]` in the backup prefix                 |
| `upload-webdav.ts`               | Upload To WebDAV               | Configures the rclone remote, uploads, then prunes by age                     |

Run one locally to see what it would do in CI, for example:

```bash
pnpm exec tsx scripts/backup/evaluate-destination-config.ts
```

The exported helpers (`evaluateConfig`, `resolveD1Target`, `shouldDeleteBackup`) are covered by `test/backup/`.

### Backup file location

```
# S3
s3://<S3_BUCKET>/aws-access-bridge/production/access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc

# WebDAV (WEBDAV_BASE_PATH defaults to aws-access-bridge)
<WEBDAV_URL>/aws-access-bridge/production/access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc
```

### What a backup contains

| Table                                             | Sensitivity in a dump                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_access_tokens`                              | **Plaintext bearer tokens.** Usable against `/api/*` until they expire; revocation is manual (`DELETE /user/tokens`).                         |
| `user_metadata`, `user_emails`                    | Sign-in addresses, superadmin flags, stable account ids.                                                                                      |
| `audit_logs`                                      | Who did what, from which IP, with which user agent.                                                                                           |
| `teams`, `team_members`, `team_accounts`          | Tenant structure and membership.                                                                                                              |
| `credentials`                                     | AES-GCM ciphertext. The key lives in the Secrets Store (`AES_ENCRYPTION_KEY_SECRET`), **not** in D1, so a dump alone cannot decrypt IAM keys. |
| `cost_data`, `resource_inventory`, `spend_alerts` | AWS account IDs, nicknames, spend, and resource inventory.                                                                                    |
| `background_task_runs`                            | Cron phase history.                                                                                                                           |

This is why `BACKUP_ENCRYPTION_KEY` is mandatory: a stolen `.enc` file is useless without it, while a stolen `.sql.gz` is a working set of API credentials.

### Decrypting a backup

```bash
export BACKUP_ENCRYPTION_KEY='your passphrase'

openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
  -in access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc \
  -out backup.sql.gz \
  -pass env:BACKUP_ENCRYPTION_KEY

gunzip backup.sql.gz   # → backup.sql
```

### Restoring the database

There is no committed `wrangler.jsonc` in this repository, so materialize one first — the restore commands assume it exists:

```bash
pnpm install
pnpm exec tsx scripts/prepare-wrangler-config.ts   # honors WRANGLER_JSONC / WRANGLER_PATCH_JSON if set
```

#### Option A — Time Travel (usually the right answer)

Fastest path, and it needs no download. See [D1 Time Travel](#d1-time-travel-point-in-time-recovery) below.

#### Option B — restore into a fresh database (recommended for file backups)

`wrangler d1 export` emits `CREATE TABLE` statements, so importing over a populated database fails. Create a clean database and repoint the binding instead:

```bash
# 1. Download the backup (custom endpoint for R2, MinIO, B2, …)
aws s3 cp s3://<S3_BUCKET>/aws-access-bridge/production/access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc ./
# …or from WebDAV
rclone copy webdav:aws-access-bridge/production/access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc ./

# 2. Decrypt and decompress
export BACKUP_ENCRYPTION_KEY='your passphrase'
openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
  -in access-bridge_prod_YYYY-MM-DD_HH-MM-SS.sql.gz.enc -out backup.sql.gz -pass env:BACKUP_ENCRYPTION_KEY
gunzip backup.sql.gz

# 3. Create the replacement database and import into it
pnpm exec wrangler d1 create aws-access-bridge-db-restored
pnpm exec wrangler d1 execute aws-access-bridge-db-restored --remote --config ./wrangler.jsonc --file=backup.sql

# 4. Repoint the binding, then deploy
#    - local:   set d1_databases[0].database_id in wrangler.jsonc
#    - forks:   update the WRANGLER_JSONC GitHub variable, then run Continuous Deployment
```

`--remote` is required; without it the command runs against the local development database.

> [!NOTE]
> Import on top of a database that already has the schema and rows will error on the `CREATE TABLE` statements. That is the reason for the create-then-repoint flow, not a corrupt backup.

#### Option C — import in place (last resort)

Only when you must keep the same database. Clear the data first — the ordering matters because of foreign keys:

```bash
pnpm exec wrangler d1 execute AccessBridgeDB --remote --config ./wrangler.jsonc \
  --command "PRAGMA foreign_keys = OFF; DELETE FROM user_access_tokens; DELETE FROM audit_logs; …"
```

> ⚠️ **Troubleshooting: `no such table: main.<x>` on import**
>
> `wrangler d1 export` can emit tables in an order that violates foreign-key dependencies (for example `assumable_roles` before `user_metadata`, or `credential_cache_config` before `credentials`). D1 honours neither `PRAGMA foreign_keys = off` nor `PRAGMA legacy_alter_table = on` — the schema in `migrations/0030_squash.sql` only avoids the problem because its `CREATE TABLE` statements are already in dependency order.
>
> Options, in order of preference:
>
> 1. Use Option B (fresh database) — the ordering problem disappears with the target schema.
> 2. Prepend `PRAGMA defer_foreign_keys=TRUE;` to the dump. The D1 exporter already emits this pragma; if your file is missing it, rebuild the head of the file:
>    ```bash
>    { echo "PRAGMA defer_foreign_keys=TRUE;"; cat backup.sql; } > restored.sql
>    pnpm exec wrangler d1 execute <DATABASE> --remote --config ./wrangler.jsonc --file=restored.sql
>    ```
> 3. As a last resort, reorder the `CREATE TABLE` statements by hand so parents precede children.

The maximum `d1 execute --file` import size is 5 GB; D1 databases cap at 10 GB (Paid) or 500 MB (Free), so a full export always fits.

## D1 Time Travel (Point-in-Time Recovery)

D1 keeps database history continuously — always on, no setup, and restores carry no extra cost. Use it for "undo that migration" or "that `DELETE` had no `WHERE`".

```bash
# Current restore bookmark
pnpm exec wrangler d1 time-travel info AccessBridgeDB --config ./wrangler.jsonc

# Bookmark for a point in the past (Unix seconds or RFC 3339)
pnpm exec wrangler d1 time-travel info AccessBridgeDB --config ./wrangler.jsonc --timestamp="2026-09-01T03:00:00Z"

# Restore (destructive — overwrites the database in place)
pnpm exec wrangler d1 time-travel restore AccessBridgeDB --config ./wrangler.jsonc --timestamp=1756687200
pnpm exec wrangler d1 time-travel restore AccessBridgeDB --config ./wrangler.jsonc --bookmark=00000085-…
```

```bash
# Confirm the database is on the Time Travel-capable backend first
pnpm exec wrangler d1 info AccessBridgeDB --config ./wrangler.jsonc   # expect version: production
```

> [!CAUTION]
>
> - Restoring **overwrites the database in place** and cancels in-flight queries; clients see errors during the restore.
> - Retention is **30 days on Workers Paid, 7 days on Workers Free** — this is your safety net, not your archive. That is what the S3/WebDAV backup is for.
> - At most 10 restores per 10 minutes per database.
> - The bookmark returned by a restore can be restored _to_ again, so a mistaken restore is itself undoable.

> [!TIP]
> Continuous Deployment runs `wrangler d1 migrations apply` on every deploy, and Cloudflare automatically captures a backup before applying a migration. Time Travel covers a bad migration even if no scheduled backup has run yet.

## References

- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
