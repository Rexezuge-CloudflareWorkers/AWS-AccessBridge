#!/usr/bin/env tsx

/**
 * Uploads the encrypted backup to S3-compatible storage and prunes expired
 * backups from the dedicated prefix.
 *
 * Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2 and anything else that
 * speaks the S3 API: set `S3_ENDPOINT` for a custom endpoint and leave
 * `S3_REGION` unset unless the provider needs a concrete region.
 */

import { execFileSync } from 'child_process';

import { fail } from './github-output';
import { requireRetentionDays, retentionCutoff } from './retention';

/** All backups live under this prefix, so pruning can never touch unrelated objects. */
export const BACKUP_PREFIX = 'aws-access-bridge/production';

export interface BackupListingEntry {
  /** `YYYY-MM-DD` as reported by `aws s3 ls`. */
  fileDate: string;
  fileName: string;
}

/**
 * True only for files this workflow produced.
 *
 * The prune is the one destructive operation in the workflow, so it refuses to
 * consider anything that is not a backup artifact in our own prefix.
 */
export function isBackupArtifact(fileName: string): boolean {
  return fileName.endsWith('.sql.gz') || fileName.endsWith('.sql.gz.enc');
}

/** Parse one `aws s3 ls` row: `<date> <time> <size> <key>`. */
export function parseS3ListRow(line: string): BackupListingEntry | undefined {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 4) {
    return undefined;
  }
  return { fileDate: fields[0], fileName: fields.slice(3).join(' ') };
}

/**
 * Decide whether a listed object should be pruned.
 *
 * Dates are `YYYY-MM-DD`, so lexicographic and chronological comparison agree.
 */
export function shouldDeleteBackup(entry: BackupListingEntry, cutoffDate: string): boolean {
  if (!isBackupArtifact(entry.fileName)) {
    return false;
  }
  return entry.fileDate < cutoffDate;
}

function aws(args: string[]): string {
  return execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const isMain = process.argv[1]?.endsWith('upload-s3.ts') ?? false;
if (isMain) {
  const bucket = process.env.S3_BUCKET;
  const file = process.env.BACKUP_FILE;
  if (!bucket || !file) {
    fail('BACKUP_FILE and S3_BUCKET must both be set to upload a backup.');
  }

  // Validate before uploading: a bad retention window should fail the run
  // without having already written to the destination.
  const retentionDays = requireRetentionDays();

  const endpointArgs = process.env.S3_ENDPOINT ? ['--endpoint-url', process.env.S3_ENDPOINT] : [];
  const remoteDir = `s3://${bucket}/${BACKUP_PREFIX}/`;

  aws(['s3', 'cp', file, remoteDir, ...endpointArgs]);
  console.log(`✅ Backup uploaded to S3: ${remoteDir}${file}`);

  const cutoffDate = retentionCutoff(new Date(), retentionDays);
  console.log(`Cleaning up backups older than ${cutoffDate}...`);

  for (const line of aws(['s3', 'ls', remoteDir, ...endpointArgs]).split('\n')) {
    const entry = parseS3ListRow(line);
    if (!entry || !shouldDeleteBackup(entry, cutoffDate)) {
      continue;
    }
    console.log(`Deleting old backup: ${entry.fileName}`);
    aws(['s3', 'rm', `${remoteDir}${entry.fileName}`, ...endpointArgs]);
  }

  console.log('✅ Cleanup completed');
}
