/**
 * Destination and encryption policy for the D1 backup workflow.
 *
 * Pure and side-effect free so `test/backup/` can assert the fail-closed rules
 * without running Actions.
 */

/**
 * The environment the `check-secrets` job is given, as repository secrets.
 */
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
  /**
   * Cloudflare credentials present, so the export job can run.
   */
  cloudflare: boolean;
  /**
   * An encryption passphrase is available.
   */
  encryption: boolean;
  /**
   * At least one upload destination is configured.
   */
  anyDestination: boolean;
  /**
   * The S3 destination is fully configured.
   */
  s3: boolean;
  /**
   * The WebDAV destination is fully configured.
   */
  webdav: boolean;
  /**
   * Human-readable reasons the run cannot proceed, empty when it can.
   */
  errors: string[];
}

/**
 * A secret counts as set only when it has non-whitespace content.
 */
function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Decides which destinations are configured and enforces fail-closed
 * encryption.
 *
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
