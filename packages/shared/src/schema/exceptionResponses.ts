/**
 * The `{Exception: {Type, Message}}` envelope every error response uses.
 *
 * Three implementations of this shape exist, which is how a wire-format change
 * could be made in one and missed in another:
 *
 * - `IActivityAPIRoute.toErrorResponse` — the route-level producer, via `c.json`.
 * - `ErrorTranslationUtil.toHTTPException` — the middleware-level producer, via a
 *   Hono `HTTPException` carrying a `JSON.stringify`-ed body.
 * - `ErrorDeserializationUtil.deserializeError` — the consumer, in reverse.
 *
 * The builders here are the OpenAPI *description* of that envelope, so all three
 * paths document one shape rather than 170 hand-copied literals across 46 endpoint
 * files. Chanfana narrows `content['application/json'].schema`, so the return type
 * is spelled out structurally below: a widened type would not be assignable from a
 * builder's return value.
 */

interface ExceptionSchemaOptions {
  /**
   * The `Type` value shown as the example, e.g. `BadRequestError`. Defaults to the
   * `IServiceError.getErrorType()` value for the matching status.
   */
  type?: string;
  /**
   * The `Message` value shown as the example. Informative to a caller reading
   * `/docs`, so it should say what actually went wrong rather than repeat the
   * status.
   */
  message?: string;
}

/**
 * The OpenAPI schema for the envelope. The `type` fields are string *literals*
 * because OpenAPI's schema object discriminates on them.
 *
 * A `type` alias rather than an `interface`, deliberately: Chanfana's
 * `SchemaObject` carries an `[x-<string>]` index signature, and only a type alias
 * is assignable to one — an interface of the identical shape is rejected with
 * "Index signature ... is missing".
 */
type ExceptionSchema = {
  type: 'object';
  properties: {
    Exception: {
      type: 'object';
      properties: {
        Type: { type: 'string'; description: string; example: string };
        Message: { type: 'string'; description: string; example: string };
      };
    };
  };
};

/**
 * A Chanfana `responses` entry for one status code. A type alias for the same
 * index-signature reason as `ExceptionSchema`.
 */
type ExceptionResponse = {
  description: string;
  content: { 'application/json': { schema: ExceptionSchema } };
};

function exceptionResponse(description: string, options: ExceptionSchemaOptions = {}): ExceptionResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            Exception: {
              type: 'object',
              properties: {
                Type: {
                  type: 'string',
                  description: 'Stable machine-readable error type.',
                  example: options.type ?? 'BadRequestError',
                },
                Message: {
                  type: 'string',
                  description: 'Human-readable detail about the error.',
                  example: options.message ?? 'Details about the invalid request',
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 400 — the request was malformed or failed validation.
 *
 * Also where a zod validation failure lands, since the request schemas reject
 * before `handleRequest` runs.
 */
function badRequestResponse(description: string, message?: string): ExceptionResponse {
  return exceptionResponse(description, { message: message ?? 'Missing required fields.', type: 'BadRequestError' });
}

/**
 * 401 — no usable credential was presented.
 */
function unauthorizedResponse(description: string, message?: string): ExceptionResponse {
  return exceptionResponse(description, {
    message: message ?? 'No personal access token provided in request headers.',
    type: 'UnauthorizedError',
  });
}

/**
 * 403 — authenticated, but not permitted. Distinct from 401 on purpose: the SPA
 * treats 401 as "sign in again" and a 403 as a real answer, so collapsing them
 * would send an administrator to the Zero Trust login page for something
 * re-authenticating cannot fix.
 */
function forbiddenResponse(description: string, message?: string): ExceptionResponse {
  return exceptionResponse(description, { message: message ?? 'You do not have permission to perform this action.', type: 'ForbiddenError' });
}

/**
 * 404 — no such resource.
 */
function notFoundResponse(description: string, message?: string): ExceptionResponse {
  return exceptionResponse(description, { message: message ?? 'The requested resource was not found.', type: 'NotFoundError' });
}

/**
 * 409 — the request conflicts with current state.
 */
function conflictResponse(description: string, message?: string): ExceptionResponse {
  return exceptionResponse(description, { message: message ?? 'The request conflicts with the current state.', type: 'ConflictError' });
}

/**
 * 500 — an unexpected server fault.
 *
 * The message shown is deliberately generic. `DatabaseError` embeds raw D1/SQLite
 * text, and `IActivityAPIRoute.toErrorResponse` already answers a 5xx with the
 * generic `DefaultInternalServerError`, so an example quoting a real internal
 * message would document a shape the server never emits.
 */
function internalServerErrorResponse(description: string): ExceptionResponse {
  return exceptionResponse(description, { message: 'An unexpected error occurred. Please try again later.', type: 'InternalServerError' });
}

export {
  badRequestResponse,
  conflictResponse,
  exceptionResponse,
  forbiddenResponse,
  internalServerErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
};
export type { ExceptionResponse, ExceptionSchema, ExceptionSchemaOptions };