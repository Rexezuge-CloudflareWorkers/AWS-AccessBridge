#!/usr/bin/env tsx

/**
 * Uploads the encrypted backup to S3-compatible storage and prunes expired
 * backups from the dedicated prefix.
 *
 * Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2 and anything else that
 * speaks the S3 API: set `S3_ENDPOINT` for a custom endpoint and leave
 * `S3_REGION` unset unless the provider needs a concrete region.
 */

import { execFileSync } from 'node:child_process';
import { fail } from '../lib/github-actions';
import { requireRetentionDays, retentionCutoff } from './retention';
import { BACKUP_PREFIX, parseS3ListRow, shouldDeleteBackup } from './s3-prune';

function aws(args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

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

const listing = aws(['s3', 'ls', remoteDir, ...endpointArgs]);
for (const line of listing.split('\n')) {
  const entry = parseS3ListRow(line);
  if (!entry || !shouldDeleteBackup(entry, cutoffDate)) {
    continue;
  }
  console.log(`Deleting old backup: ${entry.fileName}`);
  aws(['s3', 'rm', `${remoteDir}${entry.fileName}`, ...endpointArgs]);
}

console.log('✅ Cleanup completed');
