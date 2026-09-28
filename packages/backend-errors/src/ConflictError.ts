import { ErrorCode, IServiceError } from './IServiceError';

/**
 * The request is well-formed but conflicts with the current state of the
 * resource — a uniqueness violation the caller has to resolve, as opposed to
 * `BadRequestError` (malformed) or `ForbiddenError` (not allowed).
 */
class ConflictError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'The request conflicts with the current state of the resource.');
  }

  public getErrorCode(): ErrorCode {
    return 409;
  }

  public getErrorType(): string {
    return 'Conflict';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { ConflictError };
