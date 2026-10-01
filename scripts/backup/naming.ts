/**
 * Backup artifact naming, shared by the export step and the upload steps.
 *
 * Pure, so `test/backup/` can pin the format without running a job.
 */

/**
 * `2026-10-01_04-15-00` — sortable, filename-safe, and UTC.
 */
export function backupStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(':', '-')}`;
}

export function backupFileName(date: Date): string {
  return `access-bridge_prod_${backupStamp(date)}.sql.xz.enc`;
}
