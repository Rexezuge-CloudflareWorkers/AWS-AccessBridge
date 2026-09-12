import { IServiceError, ErrorResponse } from '@aws-access-bridge/backend-errors';
import { HTTPException } from 'hono/http-exception';

class ErrorTranslationUtil {
  public static toHTTPException(error: IServiceError): HTTPException {
    const errorResponse: ErrorResponse = {
      Exception: {
        Type: error.getErrorType(),
        Message: error.getErrorMessage(),
      },
    };
    return new HTTPException(error.getErrorCode(), { message: JSON.stringify(errorResponse) });
  }
}

export { ErrorTranslationUtil };
