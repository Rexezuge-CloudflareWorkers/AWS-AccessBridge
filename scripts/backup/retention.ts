/**
 * Shared retention-window handling for the backup upload scripts.
 *
 * A bad `BACKUP_RETENTION_DAYS` is rejected rather than defaulted: silently
 * falling back would either prune everything or keep backups forever, and both
 * are worse than a failed run that names the problem.
 */

import { fail } from '../lib/github-actions';

/**
 * `YYYY-MM-DD`, `days` before `now`.
 */
export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Read `BACKUP_RETENTION_DAYS` from the environment, rejecting bad values.
 */
export function requireRetentionDays(): number {
  const raw = process.env.BACKUP_RETENTION_DAYS;
  // Number() rather than parseInt(): parseInt('30d') yields 30, which would
  // silently accept a mistyped value and prune against the wrong window.
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    fail(`BACKUP_RETENTION_DAYS must be a positive number, got ${JSON.stringify(raw)}.`);
  }
  return days;
}
