/**
 * Backup artifact naming, shared by the export step and the upload steps.
 *
 * Pure, so `test/backup/` can pin the format without running a job.
 */

/**
 * The filename prefix.
 *
 * Exported rather than inlined, because `.github/workflows/backup-d1.yml` uploads with
 * `access-bridge_prod_*.sql.xz.enc` and `if-no-files-found: error`. That glob and this
 * prefix are one fact written in two places — the failure mode being a rename here that
 * silently stops every upload while each job still reports success, since the upload
 * jobs skip on `needs` rather than failing.
 */
export const BACKUP_FILE_PREFIX = 'access-bridge_prod_';

/**
 * `2026-10-01_04-15-00` — sortable, filename-safe, and UTC.
 */
export function backupStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(':', '-')}`;
}

export function backupFileName(date: Date): string {
  return `${BACKUP_FILE_PREFIX}${backupStamp(date)}.sql.xz.enc`;
}