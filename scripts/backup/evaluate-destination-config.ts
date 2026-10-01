#!/usr/bin/env tsx

/**
 * Preflight for the D1 backup workflow: decides which destinations are
 * configured and enforces the fail-closed encryption policy.
 *
 * Consumed by the `check-secrets` job. Emits `cloudflare`, `encryption`, `s3`
 * and `webdav` booleans as step outputs, which gate the downstream jobs.
 *
 * Policy: no destination configured means every backup job skips and the
 * repository stays green. A destination configured *without* an encryption key
 * is a hard failure, because AccessBridgeDB stores `user_access_tokens.access_token`
 * and user email addresses in plaintext — an unencrypted dump is a working set
 * of live API credentials, not just a data leak.
 */

import { fail, setOutput } from '../lib/github-actions';
import { evaluateConfig } from './destination-config';

const config = evaluateConfig(process.env);

console.log(
  config.cloudflare
    ? '✅ Cloudflare credentials: enabled'
    : '⚠️ Cloudflare credentials: disabled (missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID)',
);
console.log(config.encryption ? '✅ Encryption key: enabled' : '⚠️ Encryption key: disabled (BACKUP_ENCRYPTION_KEY is not set)');
console.log(config.s3 ? '✅ S3 destination: enabled' : '⚠️ S3 destination: disabled (missing credentials)');
console.log(config.webdav ? '✅ WebDAV destination: enabled' : '⚠️ WebDAV destination: disabled (missing credentials)');

setOutput('cloudflare', String(config.cloudflare));
setOutput('encryption', String(config.encryption));
setOutput('s3', String(config.s3));
setOutput('webdav', String(config.webdav));

if (config.errors.length > 0) {
  for (const error of config.errors) {
    console.error(`::error::${error}`);
  }
  fail('See docs/db-backup-recovery.md for the full secret list.');
}
