import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { isD1ErrorRetryable } from './D1ErrorClassifier';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 100;

/**
 * Backoff only; module-private, since nothing outside the retry loop needs it.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve: (value: void) => void): unknown => setTimeout(resolve, ms));
}

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
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<D1Result> {
  const maxRetries: number = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs: number = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: DatabaseError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result: D1Result = await operation();
      assertD1Success(result, context);
      return result;
    } catch (error: unknown) {
      // A thrown value that is not an `Error` is re-thrown untouched. Wrapping it
      // would discard whatever it actually is — a rejected string, a DOM
      // exception — and the `IServiceError` taxonomy has nothing useful to say
      // about it.
      if (!(error instanceof Error)) {
        throw error;
      }

      // Classified before the retry decision, and wrapped even when there is no
      // attempt left: callers map `DatabaseError` to a typed 5xx and a raw `Error`
      // would fall out of that taxonomy. An already-classified error passes
      // through unchanged, since re-wrapping would discard its `retryable` flag.
      const failure: DatabaseError = toDatabaseError(error, context);
      if (!failure.retryable || attempt >= maxRetries) {
        throw failure;
      }
      lastError = failure;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }

  throw lastError ?? new DatabaseError(`Failed to ${context} after ${maxRetries + 1} attempts`);
}

/**
 * Classify an `Error` as a `DatabaseError`.
 *
 * An already-classified error passes through unchanged — most importantly a
 * `DatabaseError` raised by `assertD1Success`, whose verdict came from
 * `isD1ErrorRetryable` on the driver's own message and would be lost to a blanket
 * re-wrap.
 *
 * Only accepts an `Error`: a non-`Error` rejection is re-thrown by the caller
 * untouched, because wrapping it would discard what it actually is.
 */
function toDatabaseError(error: Error, context: string): DatabaseError {
  return error instanceof DatabaseError
    ? error
    : new DatabaseError(`Failed to ${context}: ${error.message}`, isD1ErrorRetryable(error.message));
}

export { assertD1Success, executeD1WithRetry };
