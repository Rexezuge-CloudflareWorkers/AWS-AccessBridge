import { BadRequestError, BadGatewayError, ConflictError, ForbiddenError, NotFoundError, InternalServerError, UnauthorizedError, ServiceError, DatabaseError } from '@rexezuge/errors';
import type { ErrorResponse } from '@rexezuge/errors';

class ErrorDeserializationUtil {
  public static async deserializeError(response: Response): Promise<ServiceError> {
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
        case 'NotFound': {
          return new NotFoundError(errorMessage);
        }
        case 'Conflict': {
          return new ConflictError(errorMessage);
        }
        case 'DatabaseError': {
          return new DatabaseError(errorMessage);
        }
        case 'BadGateway': {
          return new BadGatewayError(errorMessage);
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
