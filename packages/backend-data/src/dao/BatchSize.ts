/**
 * Fallback batch size for a `LIMIT ?` a caller left unusable.
 *
 * Distinct from `Pagination`, which owns *page* sizes and lives in
 * `backend-runtime` (Layer 1) — a package `backend-data` (Layer 2) must not import
 * upward. These two batch queries are not pages: the caller walks one batch per
 * cron tick, so clamping them to `Pagination.MAX_LIMIT` would silently change how
 * much work a tick performs. All that is needed here is a positive integer,
 * because a non-numeric or non-positive `LIMIT ?` is rejected by the database.
 *
 * Matches `PRUNE_BATCH_SIZE`'s default, so a misconfigured value degrades to the
 * same batch size the pruning tasks already use.
 */
const DEFAULT_BATCH_SIZE: number = 500;

/**
 * Coerce a caller-supplied batch size to a usable positive integer.
 *
 * @param limit The requested batch size.
 * @param fallback Overridable so a caller with a different safe default (a
 *   collection task's own `MAX_ACCOUNTS_PER_COLLECTION`, say) can supply it.
 */
function toSafeBatchSize(limit: number, fallback: number = DEFAULT_BATCH_SIZE): number {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : fallback;
}

export { DEFAULT_BATCH_SIZE, toSafeBatchSize };