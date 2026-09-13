import { OpenAPIRoute } from 'chanfana';
import { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { DefaultInternalServerError, DatabaseError, InternalServerError, IServiceError } from '@aws-access-bridge/backend-errors';
import { validateRequestInput } from '@/schema';
import { getQueryParam, getRequestBaseUrl, isDemoModeEnv, withUnconstrainedD1Session } from './route-helpers';

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
      if ('rawBody' in extendedResponse) {
        return c.body((extendedResponse.rawBody ?? null) as never);
      }
      return c.json(extendedResponse.body);
    }
    return c.json(response);
  }

  protected getQueryParam(request: IRequest, name: string): string | undefined {
    return getQueryParam(request.raw, name);
  }

  protected getAuthenticatedUserEmailAddress(c: ActivityContext<TEnv>): string {
    return c.get('AuthenticatedUserEmailAddress');
  }

  protected getBaseUrl(c: ActivityContext<TEnv>): string {
    return getRequestBaseUrl(c.req.raw, c.env);
  }

  protected isDemoMode(c: ActivityContext<TEnv>): boolean {
    return isDemoModeEnv(c.env);
  }

  protected toErrorResponse(error: unknown, c: ActivityContext<TEnv>) {
    if (error instanceof IServiceError && error.getErrorCode() < 500) {
      console.warn(`Responding with ${error.getErrorType()}:`, error.stack);
      return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
    }
    if (error instanceof DatabaseError) {
      console.error('Caught database error during execution:', error);
      return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
    }
    if (!(error instanceof IServiceError) || error instanceof InternalServerError) {
      console.error('Caught service error during execution:', error);
    }
    console.warn('Responding with DefaultInternalServerError:', DefaultInternalServerError);
    return c.json(
      {
        Exception: { Type: DefaultInternalServerError.getErrorType(), Message: DefaultInternalServerError.getErrorMessage() },
      },
      DefaultInternalServerError.getErrorCode(),
    );
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
  SERVE_SPA_FROM_WORKER?: string;
  DEMO_MODE?: string;
  Variables: {
    AuthenticatedUserEmailAddress: string;
  };
  AccessBridgeDB: D1DatabaseSession;
}

type ActivityContext<TEnv extends IEnv> = Context<{ Bindings: Env } & TEnv>;

export { IActivityAPIRoute };
export type { IRequest, IResponse, IEnv, ActivityContext, ExtendedResponse };
