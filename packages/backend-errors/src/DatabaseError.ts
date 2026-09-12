import { InternalServerError } from './InternalServerError';

class DatabaseError extends InternalServerError {
  constructor(message?: string) {
    super(message ?? 'The system encountered an unexpected problem while accessing the database. Your request could not be completed.');
  }

  public getErrorType(): string {
    return 'DatabaseError';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { DatabaseError };
