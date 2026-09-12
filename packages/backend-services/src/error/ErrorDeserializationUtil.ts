import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  UnauthorizedError,
  IServiceError,
  DatabaseError,
} from '@aws-access-bridge/backend-errors';
import type { ErrorResponse } from '@aws-access-bridge/backend-errors';

class ErrorDeserializationUtil {
  public static async deserializeError(response: Response): Promise<IServiceError> {
    try {
      const errorData: ErrorResponse = await response.json();
      const errorType: string = errorData.Exception?.Type || 'InternalServerError';
      const errorMessage: string = errorData.Exception?.Message || 'Unknown error occurred';
      switch (errorType) {
        case 'BadRequest': {
          return new BadRequestError(errorMessage);
        }
        case 'Unauthorized': {
          return new UnauthorizedError(errorMessage);
        }
        case 'Forbidden': {
          return new ForbiddenError(errorMessage);
        }
        case 'DatabaseError': {
          return new DatabaseError(errorMessage);
        }
        default: {
          return new InternalServerError(errorMessage);
        }
      }
    } catch {
      return new InternalServerError(`HTTP ${response.status}: ${response.statusText}`);
    }
  }
}

export { ErrorDeserializationUtil };
