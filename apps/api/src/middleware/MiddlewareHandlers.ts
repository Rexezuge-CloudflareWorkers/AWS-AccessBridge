import { AUDIT_ACTIONS } from '@/constants/AuditActions';
import {
  DEMO_USER_EMAIL,
  DEFAULT_DEMO_MODE,
  INTERNAL_HEADER_PREFIX,
  INTERNAL_USER_EMAIL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@/constants';
import { AuditLogDAO } from '@/dao/AuditLogDAO';
import { Context, Next } from 'hono';
import { HMACHandler } from './HMACHandler';
import { IServiceError, UnauthorizedError } from '@/error';
import { EmailValidationUtil } from '@/utils/EmailValidationUtil';
import { ErrorTranslationUtil } from '@/utils/ErrorTranslationUtil';
import { RequestOriginUtil } from '@/utils/RequestOriginUtil';
import { TokenAuthUtil } from '@/utils/TokenAuthUtil';

type RequestContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;
type AuthenticatedEnv = Env & {
  DEMO_MODE?: string | undefined;
  TEAM_DOMAIN?: string | undefined;
  POLICY_AUD?: string | undefined;
  AccessBridgeDB: D1DatabaseSession;
};

class MiddlewareHandlers {
  public static hmacValidation() {
    return async (c: Context<{ Bindings: Env }>, next: Next): Promise<void> => {
      const url: URL = new URL(c.req.url);
      const hasInternalHeaders: boolean = Array.from(c.req.raw.headers.keys()).some((key) => key.startsWith(INTERNAL_HEADER_PREFIX));
      if (url.hostname === SELF_WORKER_BASE_HOSTNAME || hasInternalHeaders) {
        await this.withErrorTranslation(HMACHandler.validateInternalRequest)(c, next);
      } else {
        await next();
      }
    };
  }

  public static activityAudit() {
    return async (c: RequestContext, next: Next): Promise<void> => {
      let statusCode: number = 200;

      try {
        await next();
        statusCode = c.res.status;
      } catch (error: unknown) {
        if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
          statusCode = error.status;
        } else {
          statusCode = 500;
        }
        throw error;
      } finally {
        try {
          const method: string = c.req.method;
          const url: URL = new URL(c.req.url);
          const path: string = url.pathname;
          const action: string = AUDIT_ACTIONS[`${method}:${path}`] || `${method}:${path}`;
          const userEmail: string = c.get('AuthenticatedUserEmailAddress') || 'unknown';
          const ipAddress: string | undefined = RequestOriginUtil.getClientIpAddress(c.req.raw, c.env);
          const userAgentHeader: string | undefined = c.req.header('User-Agent');

          const auditLogDAO: AuditLogDAO = new AuditLogDAO(c.env.AccessBridgeDB);
          c.executionCtx.waitUntil(
            auditLogDAO.create(userEmail, action, method, path, statusCode, undefined, undefined, ipAddress, userAgentHeader),
          );
        } catch {
          console.warn('Failed to write audit log');
        }
      }
    };
  }

  public static userAuthentication() {
    return async (c: RequestContext, next: Next): Promise<Response | void> => {
      try {
        const userEmail: string = await this.authenticateUserIdentity(c);
        c.set('AuthenticatedUserEmailAddress', userEmail);
        await next();
      } catch (error: unknown) {
        if (error instanceof IServiceError) {
          return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
        }
        throw error;
      }
    };
  }

  public static apiAuthentication() {
    return async (c: RequestContext, next: Next): Promise<Response | void> => {
      try {
        const userEmail: string = await this.authenticateApiIdentity(c);
        c.set('AuthenticatedUserEmailAddress', userEmail);
        await next();
      } catch (error: unknown) {
        if (error instanceof IServiceError) {
          return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
        }
        throw error;
      }
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static withErrorTranslation<T extends any[], R>(fn: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error: unknown) {
        if (error instanceof IServiceError) {
          throw ErrorTranslationUtil.toHTTPException(error);
        }
        throw error;
      }
    };
  }

  private static async authenticateUserIdentity(c: RequestContext): Promise<string> {
    const env: AuthenticatedEnv = c.env as AuthenticatedEnv;
    if ((env.DEMO_MODE || DEFAULT_DEMO_MODE) === 'true') {
      return DEMO_USER_EMAIL;
    }
    return await EmailValidationUtil.getAuthenticatedUserEmail(c.req.raw, env.TEAM_DOMAIN, env.POLICY_AUD);
  }

  private static async authenticateApiIdentity(c: RequestContext): Promise<string> {
    const env: AuthenticatedEnv = c.env as AuthenticatedEnv;
    if ((env.DEMO_MODE || DEFAULT_DEMO_MODE) === 'true') {
      return DEMO_USER_EMAIL;
    }
    if (this.isInternalRequest(c)) {
      const internalEmail: string | null = c.req.raw.headers.get(INTERNAL_USER_EMAIL_HEADER);
      if (internalEmail) {
        return internalEmail;
      }
      throw new UnauthorizedError('Internal call missing required user email header.');
    }
    const authHeader: string | undefined = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token: string = authHeader.substring(7);
      return await TokenAuthUtil.authenticateWithPAT(token, env.AccessBridgeDB);
    }
    throw new UnauthorizedError('No personal access token provided in request headers.');
  }

  private static isInternalRequest(c: RequestContext): boolean {
    const url: URL = new URL(c.req.url);
    if (url.hostname === SELF_WORKER_BASE_HOSTNAME) {
      return true;
    }
    return Array.from(c.req.raw.headers.keys()).some((key) => key.startsWith(INTERNAL_HEADER_PREFIX));
  }
}

export { MiddlewareHandlers };
