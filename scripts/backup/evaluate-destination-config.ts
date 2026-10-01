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

import { fail, setOutput } from './github-output';

export interface BackupSecretEnvironment {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  BACKUP_ENCRYPTION_KEY?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  WEBDAV_URL?: string;
  WEBDAV_USER?: string;
  WEBDAV_PASSWORD?: string;
}

export interface DestinationConfig {
  /** Cloudflare credentials present, so the export job can run. */
  cloudflare: boolean;
  /** An encryption passphrase is available. */
  encryption: boolean;
  /** At least one upload destination is configured. */
  anyDestination: boolean;
  /** The S3 destination is fully configured. */
  s3: boolean;
  /** The WebDAV destination is fully configured. */
  webdav: boolean;
  /** Human-readable reasons the run cannot proceed, empty when it can. */
  errors: string[];
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * S3_REGION is deliberately not part of the S3 gate. R2 and MinIO have no
 * meaningful region — Cloudflare documents an R2 bucket's region as `auto`,
 * with empty and `us-east-1` both aliasing to it — so requiring the secret
 * would silently disable backups for anyone using such a provider. The upload
 * script defaults `AWS_DEFAULT_REGION` to `auto` instead.
 */
export function evaluateConfig(env: BackupSecretEnvironment): DestinationConfig {
  const cloudflare = isSet(env.CLOUDFLARE_API_TOKEN) && isSet(env.CLOUDFLARE_ACCOUNT_ID);
  const encryption = isSet(env.BACKUP_ENCRYPTION_KEY);
  const s3 = isSet(env.S3_ACCESS_KEY_ID) && isSet(env.S3_SECRET_ACCESS_KEY) && isSet(env.S3_BUCKET);
  const webdav = isSet(env.WEBDAV_URL) && isSet(env.WEBDAV_USER) && isSet(env.WEBDAV_PASSWORD);
  const anyDestination = s3 || webdav;

  const errors: string[] = [];

  // Fail closed, but only once someone has opted into a destination. An
  // unconfigured repository is a legitimate "I do not want off-site backups"
  // state and must not turn the schedule red.
  if (anyDestination) {
    if (!cloudflare) {
      errors.push('A backup destination is configured but CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are missing.');
    }
    if (!encryption) {
      errors.push(
        'BACKUP_ENCRYPTION_KEY is required. AccessBridgeDB stores user_access_tokens.access_token and user addresses in plaintext.',
      );
    }
  }

  return { cloudflare, encryption, anyDestination, s3, webdav, errors };
}

const isMain = process.argv[1]?.endsWith('evaluate-destination-config.ts') ?? false;
if (isMain) {
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
}
