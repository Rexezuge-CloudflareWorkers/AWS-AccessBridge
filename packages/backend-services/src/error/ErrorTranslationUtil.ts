import { ServiceError } from '@rexezuge/errors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

class ErrorTranslationUtil {
  public static toHTTPException(error: ServiceError): HTTPException {
    const response = error.toErrorResponse();
    return new HTTPException(response.status as ContentfulStatusCode, { message: JSON.stringify(response.body) });
  }
}

export { ErrorTranslationUtil };
