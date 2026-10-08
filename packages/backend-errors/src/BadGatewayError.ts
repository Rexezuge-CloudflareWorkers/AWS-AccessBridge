import { ErrorCode, IServiceError } from './IServiceError';

/**
 * An upstream dependency (AWS STS, the signin endpoint, ...) failed or did not
 * answer, through no fault of the caller's request or session.
 *
 * Distinct from `UnauthorizedError` on purpose: the SPA treats 401 as "your
 * session ended" and bounces to the Zero Trust login, which cannot fix a
 * failing upstream. 502 says "someone else is broken", and `retryable` lets a
 * scheduler tell a timeout from a permanent refusal.
 */
class BadGatewayError extends IServiceError {
  constructor(message?: string, retryable: boolean = false) {
    super(message ?? 'An upstream service failed to complete the request.');
    this.retryable = retryable;
  }

  public getErrorCode(): ErrorCode {
    return 502;
  }

  public getErrorType(): string {
    return 'BadGateway';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { BadGatewayError };
