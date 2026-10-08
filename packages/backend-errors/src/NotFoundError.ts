import { ErrorCode, IServiceError } from './IServiceError';

/**
 * The thing the request names does not exist — a team that was never created, a
 * member who is not in the team, a credentials row nobody stored.
 *
 * Distinct from `UnauthorizedError` on purpose: the SPA reads a 401 as "sign in
 * again", so a missing row must never be answered with one.
 */
class NotFoundError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'The requested resource was not found.');
  }

  public getErrorCode(): ErrorCode {
    return 404;
  }

  public getErrorType(): string {
    return 'NotFound';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { NotFoundError };
