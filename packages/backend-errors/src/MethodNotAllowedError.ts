import { ErrorCode, IServiceError } from './IServiceError';

class MethodNotAllowedError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'This operation is not allowed in demo mode.');
  }

  public getErrorCode(): ErrorCode {
    return 405;
  }

  public getErrorType(): string {
    return 'MethodNotAllowed';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { MethodNotAllowedError };
