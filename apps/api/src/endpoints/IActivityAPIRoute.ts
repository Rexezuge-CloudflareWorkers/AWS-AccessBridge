import { OpenAPIRoute } from 'chanfana';
import { Context } from 'hono';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import { DefaultInternalServerError, DatabaseError, InternalServerError, IServiceError } from '@aws-access-bridge/backend-errors';
import { validateRequestInput } from '@/schema';
import { getQueryParam, getRequestBaseUrl, isDemoModeEnv, withUnconstrainedD1Session } from './route-helpers';

import { log } from '@aws-access-bridge/shared/utils';
abstract class IActivityAPIRoute<TRequest extends IRequest, TResponse extends IResponse, TEnv extends IEnv> extends OpenAPIRoute {
  async handle(c: ActivityContext<TEnv>) {
    try {
      let body: unknown = {};
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
      const validatedBody: unknown = await validateRequestInput(c.req.raw, body);
      const request: TRequest = { ...(validatedBody as TRequest), raw: c.req.raw };
      const env: TEnv = withUnconstrainedD1Session({ ...(c.env as TEnv) });
      const response: TResponse | ExtendedResponse<TResponse> = await this.handleRequest(request, env, c);
      return this.toResponse(response, c);
    } catch (error: unknown) {
      return this.toErrorResponse(error, c);
    }
  }

  /**
   * The context is always the third argument, even when a handler does not need
   * it: it is the request's identity, and without it a handler cannot reach the
   * per-request composition scope (`getRequestScope(cxt)`). Omitting it is how
   * handlers ended up rebuilding a scope from `env` and fetching the encryption
   * secrets twice.
   */
  protected abstract handleRequest(
    request: TRequest,
    env: TEnv,
    cxt: ActivityContext<TEnv>,
  ): Promise<TResponse | ExtendedResponse<TResponse>>;

  protected toResponse(response: TResponse | ExtendedResponse<TResponse>, c: ActivityContext<TEnv>) {
    if (
      response &&
      typeof response === 'object' &&
      ('body' in response || 'rawBody' in response || 'statusCode' in response || 'headers' in response)
    ) {
      const extendedResponse: ExtendedResponse<TResponse> = response;
      const statusCode: number = extendedResponse.statusCode || 200;
      const headers: Record<string, string> = extendedResponse.headers || {};
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      c.status(statusCode as StatusCode);
      if (statusCode >= 300 && statusCode < 400) {
        return c.body(null);
      }
      return 'rawBody' in extendedResponse ? c.body((extendedResponse.rawBody ?? null) as never) : c.json(extendedResponse.body);
    }
    return c.json(response);
  }

  protected getQueryParam(request: IRequest, name: string): string | undefined {
    return getQueryParam(request.raw, name);
  }

  protected getAuthenticatedUserEmailAddress(c: ActivityContext<TEnv>): string {
    return c.get('AuthenticatedUserEmailAddress');
  }

  /**
   * The stable account id for the authenticated caller, or null when the
   * database predates migration 0032 or the account could not be resolved.
   * Services prefer it where available but must not require it.
   */
  protected getAuthenticatedUserId(c: ActivityContext<TEnv>): string | null {
    return c.get('AuthenticatedUserId') ?? null;
  }

  protected getBaseUrl(c: ActivityContext<TEnv>): string {
    return getRequestBaseUrl(c.req.raw, c.env);
  }

  protected isDemoMode(c: ActivityContext<TEnv>): boolean {
    return isDemoModeEnv(c.env);
  }

  protected toErrorResponse(error: unknown, c: ActivityContext<TEnv>) {
    if (error instanceof IServiceError && error.getErrorCode() < 500) {
      log.warn(`Responding with ${error.getErrorType()}:`, { error: error.stack });
      return this.exceptionResponse(c, error, error.getErrorCode());
    }
    if (error instanceof DatabaseError) {
      // DatabaseError messages embed the underlying D1/SQLite text (table and
      // column names, constraint names, statement offsets), so they are logged
      // rather than returned. Callers get the same generic 500 as any other
      // server-side fault.
      log.error('Caught database error during execution:', { error: error });
    }
    if (!(error instanceof IServiceError) || error instanceof InternalServerError) {
      log.error('Caught service error during execution:', { error: error });
    }
    log.warn('Responding with DefaultInternalServerError:', { error: DefaultInternalServerError });
    return this.exceptionResponse(c, DefaultInternalServerError, DefaultInternalServerError.getErrorCode());
  }

  /**
   * The `{Exception: {Type, Message}}` envelope every error response shares.
   *
   * `status` is a plain number rather than Hono's `StatusCode` because the two
   * call sites pass `getErrorCode()`, which is `ContentfulStatusCode` — the
   * declared type of which is narrower than the generic this route's context
   * infers.
   */
  private exceptionResponse(c: ActivityContext<TEnv>, error: IServiceError, status: ContentfulStatusCode) {
    return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, status as never);
  }
}

interface IRequest {
  raw: Request;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IResponse {}

interface ExtendedResponse<TResponse extends IResponse> {
  body?: TResponse;
  rawBody?: BodyInit | null;
  statusCode?: StatusCode;
  headers?: Record<string, string>;
}

interface IEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  DEMO_MODE?: string;
  Variables: {
    AuthenticatedUserEmailAddress: string;
    /**
    Stable account key (migration 0032); absent on a database without it.
    */
    AuthenticatedUserId?: string;
  };
  AccessBridgeDB: D1DatabaseSession;
}

type ActivityContext<TEnv extends IEnv> = Context<{ Bindings: Env } & TEnv>;

export { IActivityAPIRoute };
export type { IRequest, IResponse, IEnv, ActivityContext, ExtendedResponse };
