import { ErrorCode, IServiceError } from './IServiceError';

class ForbiddenError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'You do not have permission to access this resource.');
  }

  public getErrorCode(): ErrorCode {
    return 403;
  }

  public getErrorType(): string {
    return 'Forbidden';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { ForbiddenError };
