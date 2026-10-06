import type { AwsSignedClient } from '@aws-access-bridge/provider-clients/aws';

import { HttpFetchError, isRetryableHttpStatus, isRetryableThrownError } from './HttpFetchError';

/**
 * Jitter source, injectable so the backoff is deterministically testable.
 * Backed by `crypto.getRandomValues` rather than `Math.random`: it only spreads
 * timing, and never decides access, retries, or any value that reaches a
 * response.
 */
type Jitter = (max: number) => number;

const cryptoJitter: Jitter = (max: number): number => {
  if (max <= 0) return 0;
  const buffer = new Uint32Array(new ArrayBuffer(4));
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
};

/**
 * Ceiling on any single backoff wait.
 *
 * `Retry-After` is AWS's authoritative backoff request, but it is stated in
 * seconds for a *client* that can wait — a throttled STS endpoint will happily
 * answer `Retry-After: 120`. Honouring that literally inside a Workers request
 * means `setTimeout` outlives the request's wall-clock limit: the request dies
 * mid-sleep and the caller sees a timeout instead of the 429 that actually
 * happened. So a wait beyond the ceiling is not shortened (a shorter sleep just
 * earns another throttle) — it is declined, and the last response is returned.
 */
const MAX_RETRY_DELAY_MS = 5000;

/**
 * An AWS client that retries a throttled or transiently-faulted call.
 *
 * Without it a single `Throttling` on one hop of a credential chain failed the
 * whole operation for the caller, even though the same request usually succeeds
 * immediately. Attempts are bounded and the delay is exponential with jitter:
 * without the jitter, every concurrent request retries in lockstep and
 * reproduces the burst that caused the throttle.
 *
 * Both failure routes are classified. A retryable status retries; a rejection
 * retries only when `isRetryableThrownError` says the cause is transient, so a
 * permanent `AccessDenied` surfaces on the first attempt rather than after the
 * full backoff schedule.
 */
class RetryingAwsClient implements AwsSignedClient {
  constructor(
    private readonly inner: AwsSignedClient,
    private readonly maxAttempts: number = 3,
    private readonly baseDelayMs: number = 100,
    private readonly jitter: Jitter = cryptoJitter,
    private readonly maxDelayMs: number = MAX_RETRY_DELAY_MS,
  ) {}

  public async fetch(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const isLastAttempt: boolean = attempt === this.maxAttempts - 1;

      let response: Response;
      try {
        response = await this.inner.fetch(url, init);
      } catch (error: unknown) {
        if (isLastAttempt || !isRetryableThrownError(error)) {
          throw error;
        }
        await RetryingAwsClient.delay(this.nextDelayMs(attempt) ?? 0);
        continue;
      }

      if (isLastAttempt || !isRetryableHttpStatus(response.status)) {
        return response;
      }
      const delayMs: number | undefined = this.nextDelayMs(attempt, response);
      if (delayMs === undefined) {
        // The server asked for longer than this request can wait. Returning its
        // answer is more useful than sleeping past the request's own deadline.
        return response;
      }
      await RetryingAwsClient.delay(delayMs);
    }
    // Unreachable: the loop returns or throws on its final iteration. Present so
    // the signature has a total return type.
    throw new HttpFetchError(0, 'Retries exhausted', `Gave up after ${this.maxAttempts} attempts: ${url}`);
  }

  /**
   * @returns The wait before the next attempt, or `undefined` when the server
   * requested a wait this request cannot afford.
   */
  private nextDelayMs(attempt: number, response?: Response): number | undefined {
    const retryAfterSeconds: number | undefined = RetryingAwsClient.parseRetryAfter(response);
    if (retryAfterSeconds !== undefined) {
      const requestedMs: number = retryAfterSeconds * 1000;
      return requestedMs <= this.maxDelayMs ? requestedMs : undefined;
    }
    // Full jitter across the exponential window, so concurrent callers do not
    // retry in lockstep and reproduce the burst that caused the throttle.
    return Math.min(this.jitter(this.baseDelayMs * 2 ** attempt), this.maxDelayMs);
  }

  private static parseRetryAfter(response?: Response): number | undefined {
    const header: string | null = response?.headers.get('Retry-After') ?? null;
    if (!header) {
      return undefined;
    }
    const seconds: number = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }

  private static async delay(ms: number): Promise<void> {
    await new Promise((resolve: (value: void) => void): unknown => setTimeout(resolve, ms));
  }
}

export { MAX_RETRY_DELAY_MS, RetryingAwsClient };
export type { Jitter };