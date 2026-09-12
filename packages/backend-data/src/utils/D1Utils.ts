import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { isD1ErrorRetryable } from './D1ErrorClassifier';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: (value: void) => void): unknown => setTimeout(resolve, ms));
}

function assertD1Success(result: D1Result, context: string): void {
  if (result.success) {
    return;
  }

  const errorMessage: string = result.error ?? 'Unknown database error';
  const retryable: boolean = isD1ErrorRetryable(errorMessage);
  throw new DatabaseError(`Failed to ${context}: ${errorMessage}`, retryable);
}

async function executeD1WithRetry(
  operation: () => Promise<D1Result>,
  context: string,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<D1Result> {
  const maxRetries: number = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs: number = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result: D1Result = await operation();
      if (!result.success) {
        const errorMessage: string = result.error ?? 'Unknown database error';
        const retryable: boolean = isD1ErrorRetryable(errorMessage);
        if (retryable && attempt < maxRetries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw new DatabaseError(`Failed to ${context}: ${errorMessage}`, retryable);
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof DatabaseError) {
        if (error.retryable && attempt < maxRetries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          lastError = error;
          continue;
        }
        throw error;
      }
      if (error instanceof Error) {
        const retryable: boolean = isD1ErrorRetryable(error.message);
        if (retryable && attempt < maxRetries) {
          await sleep(baseDelayMs * Math.pow(2, attempt));
          lastError = error;
          continue;
        }
        throw new DatabaseError(`Failed to ${context}: ${error.message}`, retryable);
      }
      throw error;
    }
  }

  throw lastError ?? new DatabaseError(`Failed to ${context} after ${maxRetries + 1} attempts`);
}

export { assertD1Success, executeD1WithRetry, sleep };
