import { DatabaseError } from '@rexezuge/errors';
import { executeWithRetry, isD1ErrorRetryable } from '@rexezuge/d1';
import type { D1RetryOptions, D1Result } from '@rexezuge/d1';

/**
 * Turn a failed D1 result into a `DatabaseError`, or `undefined` if it succeeded.
 *
 * D1 resolves a failed statement with `{success: false}` rather than rejecting, so
 * every statement has to be checked or it reports success for a row that does not
 * exist. That is how `TeamsDAO.createTeam` once returned a `teamId` resolving to
 * nothing, and how `AuditLogDAO.deleteOlderThanBatch` made `AbstractPruningTask`
 * log "Pruned 0 rows" and exit successfully while retention silently stopped.
 *
 * The retryable verdict comes from `isD1ErrorRetryable`, so a busy or throttled
 * database is retried and a constraint violation is not — re-running a duplicate
 * insert cannot succeed.
 */
function assertD1Success(result: D1Result, context: string): void {
  if (result.success) {
    return;
  }

  const errorMessage: string = result.error ?? 'Unknown database error';
  const retryable: boolean = isD1ErrorRetryable(errorMessage);
  throw new DatabaseError(`Failed to ${context}: ${errorMessage}`, retryable);
}

/**
 * Run a D1 operation, retrying only retryable failures.
 *
 * Both failure routes converge on one policy: D1's `{success: false}` result and a
 * rejected promise. Handling the second here means a DAO does not have to
 * distinguish them, and it is why the inline `if (!result.success) throw new
 * DatabaseError(...)` that ~40 call sites carried is now one function — previously
 * `assertD1Success` existed for exactly this and a single DAO used it, so a fix to
 * the policy would have missed the rest.
 */
async function executeD1WithRetry(
  operation: () => Promise<D1Result>,
  context: string,
  options?: D1RetryOptions,
): Promise<D1Result> {
  return executeWithRetry(operation, context, options);
}

export { assertD1Success, executeD1WithRetry };
