/**
 * Deciding which S3 objects the retention prune may delete.
 *
 * Pure, so `test/backup/` can assert the safety rules without an S3 bucket.
 */

/**
 * All backups live under this prefix, so pruning can never touch unrelated objects.
 */
export const BACKUP_PREFIX = 'aws-access-bridge/production';

export interface BackupListingEntry {
  /**
   * `YYYY-MM-DD` as reported by `aws s3 ls`.
   */
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
  // `.gz` is retained so backups written before the switch to xz still age out.
  // Dropping it would leave every pre-switch object in the bucket forever.
  return (
    fileName.endsWith('.sql.xz') || fileName.endsWith('.sql.xz.enc') || fileName.endsWith('.sql.gz') || fileName.endsWith('.sql.gz.enc')
  );
}

/**
 * Parse one `aws s3 ls` row: `<date> <time> <size> <key>`.
 */
export function parseS3ListRow(line: string): BackupListingEntry | undefined {
  const fields = line.trim().split(/\s+/);
  return fields.length < 4 ? undefined : { fileDate: fields[0] as string, fileName: fields.slice(3).join(' ') };
}

/**
 * Decide whether a listed object should be pruned.
 *
 * Dates are `YYYY-MM-DD`, so lexicographic and chronological comparison agree.
 */
export function shouldDeleteBackup(entry: BackupListingEntry, cutoffDate: string): boolean {
  return isBackupArtifact(entry.fileName) && entry.fileDate < cutoffDate;
}
