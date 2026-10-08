import { ErrorCode, IServiceError } from './IServiceError';

/**
 * The auth boundary admitted too many attempts from one key in one window.
 *
 * The SPA keys its login redirect on 401; a throttled client is not told to
 * re-authenticate, it is told to slow down, so it has its own status.
 */
class RateLimitedError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'Too many requests. Slow down and retry.');
  }

  public getErrorCode(): ErrorCode {
    return 429;
  }

  public getErrorType(): string {
    return 'RateLimited';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { RateLimitedError };
