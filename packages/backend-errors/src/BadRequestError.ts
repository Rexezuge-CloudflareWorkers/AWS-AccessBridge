import { ErrorCode, IServiceError } from './IServiceError';

class BadRequestError extends IServiceError {
  constructor(message?: string) {
    super(message ?? 'The request could not be understood by the server due to malformed syntax.');
  }

  public getErrorCode(): ErrorCode {
    return 400;
  }

  public getErrorType(): string {
    return 'BadRequest';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { BadRequestError };
