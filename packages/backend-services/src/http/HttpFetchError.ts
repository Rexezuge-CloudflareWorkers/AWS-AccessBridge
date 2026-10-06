/**
 * Classifies a thrown value as worth another attempt.
 *
 * The status path is decided by `isRetryableHttpStatus`; this handles the other
 * one, where the client rejects instead of answering. `RetryingAwsClient` used to
 * retry *every* rejection, which meant an `AccessDenied` or an `ExpiredToken` on
 * the STS assume-role path burned every attempt plus the exponential backoff
 * before surfacing — a permanent failure presenting as a slow one.
 *
 * Order matters and mirrors `D1ErrorClassifier`: permanent patterns are tested
 * first, so an error mentioning both (a throttled request to an unauthorized
 * action, say) is treated as permanent.
 */
const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /access\s*denied/i,
  /unauthori[sz]ed/i,
  /forbidden/i,
  /expired/i,
  /invalid/i,
  /malformed/i,
  /unsupported/i,
  /validation/i,
  /not\s*found/i,
  /signature/i,
  /security\s*token/i,
  /disabled/i,
  /policy/i,
  /credential/i,
  // A uniqueness collision is a statement about the request, not the service's
  // mood: the same payload collides again however long we wait.
  /already\s*exists/i,
  /conflict/i,
  /limit\s*exceeded/i,
];

const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /throttl/i,
  /rate\s*exceeded/i,
  /too\s*many\s*requests/i,
  /service\s*unavailable/i,
  /internal\s*(server\s*)?error/i,
  /timeout/i,
  /timed\s*out/i,
  /temporar/i,
  /try\s*again/i,
  /connection/i,
  /network/i,
  /reset/i,
  /busy/i,
  /socket/i,
];

interface HttpFetchErrorOptions {
  /**
   * Overrides the status-derived verdict.
   *
   * Needed because not every failure is the server's answer: `parseJsonBody`
   * reports a malformed 2xx body with status 200, and retrying a body we failed to
   * parse cannot change the outcome. Defaulting to the status rule would have
   * marked that retryable only because 200 is not a 5xx — the opposite of right.
   */
  retryable?: boolean;
}

class HttpFetchError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly body: string;
  public readonly retryable: boolean;

  constructor(status: number, statusText: string, body: string, options?: HttpFetchErrorOptions) {
    super(`HTTP request failed (${status.toString()}): ${body || statusText}`);
    this.name = 'HttpFetchError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.retryable = options?.retryable ?? isRetryableHttpStatus(status);
  }
}

/**
 * 429 and 5xx are worth another attempt; a 4xx will fail identically.
 */
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableThrownError(error: unknown): boolean {
  // A typed carrier that already made the call — `HttpFetchError` from a
  // non-OK response, `AwsCollectionError` from a collector — is authoritative.
  // Re-deriving it from the message would discard the verdict its constructor
  // already reached from richer information.
  if (error instanceof HttpFetchError) {
    return error.retryable;
  }
  const carried: unknown = (error as { retryable?: unknown } | null | undefined)?.retryable;
  if (typeof carried === 'boolean') {
    return carried;
  }

  const message: string = error instanceof Error ? error.message : String(error);
  if (!message) {
    return false;
  }
  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(message)) return false;
  }
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  // Unclassified: retry. An unrecognised error is far more often a transport
  // fault we have no pattern for than a deliberate refusal, and preserving the
  // previous behaviour here is the safe direction — the known-permanent cases
  // above are what this function exists to stop.
  return true;
}

export { HttpFetchError, isRetryableHttpStatus, isRetryableThrownError };
export type { HttpFetchErrorOptions };