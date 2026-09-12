import { AUDIT_ACTIONS } from '@aws-access-bridge/backend-services/audit/AuditActions';
import {
  DEMO_USER_EMAIL,
  DEFAULT_DEMO_MODE,
  INTERNAL_HEADER_PREFIX,
  INTERNAL_USER_EMAIL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@aws-access-bridge/shared/constants';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { Context, Next } from 'hono';
import { HMACHandler } from './HMACHandler';
import { IServiceError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { EmailValidationUtil } from '@aws-access-bridge/backend-services/auth/EmailValidationUtil';
import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';
import { RequestOriginUtil } from '@aws-access-bridge/shared/utils/RequestOriginUtil';
import { TokenAuthUtil } from '@aws-access-bridge/backend-services/auth/TokenAuthUtil';

type RequestContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;
type AuthenticatedEnv = Env & {
  DEMO_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  AccessBridgeDB: D1DatabaseSession;
};

async function validateInternalRequest(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  await HMACHandler.validateInternalRequest(c, next);
}

function hasInternalHeadersFor(headers: Headers): boolean {
  for (const key of headers.keys()) {
    if (key.startsWith(INTERNAL_HEADER_PREFIX)) {
      return true;
    }
  }
  return false;
}

async function authenticateUserIdentity(c: RequestContext): Promise<string> {
  const env: AuthenticatedEnv = c.env as AuthenticatedEnv;
  if ((env.DEMO_MODE || DEFAULT_DEMO_MODE) === 'true') {
    return DEMO_USER_EMAIL;
  }
  // Local-only bypass for integration tests and `wrangler dev`. Never set in production.
  if (env.DEV_AUTH_EMAIL) {
    return env.DEV_AUTH_EMAIL;
  }
  return await EmailValidationUtil.getAuthenticatedUserEmail(c.req.raw, env.TEAM_DOMAIN, env.POLICY_AUD);
}

function isInternalRequest(c: RequestContext): boolean {
  const url: URL = new URL(c.req.url);
  if (url.hostname === SELF_WORKER_BASE_HOSTNAME) {
    return true;
  }
  return hasInternalHeadersFor(c.req.raw.headers);
}

async function authenticateApiIdentity(c: RequestContext): Promise<string> {
  const env: AuthenticatedEnv = c.env as AuthenticatedEnv;
  if ((env.DEMO_MODE || DEFAULT_DEMO_MODE) === 'true') {
    return DEMO_USER_EMAIL;
  }
  if (isInternalRequest(c)) {
    const internalEmail: string | null = c.req.raw.headers.get(INTERNAL_USER_EMAIL_HEADER);
    if (internalEmail) {
      return internalEmail;
    }
    throw new UnauthorizedError('Internal call missing required user email header.');
  }
  const authHeader: string | undefined = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token: string = authHeader.slice(7);
    return await TokenAuthUtil.authenticateWithPAT(token, env.AccessBridgeDB);
  }
  throw new UnauthorizedError('No personal access token provided in request headers.');
}

async function activityAuditHandler(c: RequestContext, next: Next): Promise<void> {
  let statusCode: number = 200;

  try {
    await next();
    statusCode = c.res.status;
  } catch (error: unknown) {
    statusCode = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
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
}

async function userAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  try {
    const userEmail: string = await authenticateUserIdentity(c);
    c.set('AuthenticatedUserEmailAddress', userEmail);
    await next();
  } catch (error: unknown) {
    if (error instanceof IServiceError) {
      return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
    }
    throw error;
  }
}

async function apiAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  try {
    const userEmail: string = await authenticateApiIdentity(c);
    c.set('AuthenticatedUserEmailAddress', userEmail);
    await next();
  } catch (error: unknown) {
    if (error instanceof IServiceError) {
      return c.json({ Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } }, error.getErrorCode());
    }
    throw error;
  }
}

class MiddlewareHandlers {
  public static hmacValidation() {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- middleware factory must return a closure capturing `this`
    return async (c: Context<{ Bindings: Env }>, next: Next): Promise<void> => {
      const url: URL = new URL(c.req.url);
      const hasInternalHeaders: boolean = hasInternalHeadersFor(c.req.raw.headers);
      if (hasInternalHeaders || url.hostname === SELF_WORKER_BASE_HOSTNAME) {
        await this.withErrorTranslation(validateInternalRequest)(c, next);
      } else {
        await next();
      }
    };
  }

  public static activityAudit(): (c: RequestContext, next: Next) => Promise<void> {
    return activityAuditHandler;
  }

  public static userAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return userAuthenticationHandler;
  }

  public static apiAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return apiAuthenticationHandler;
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
}

export { MiddlewareHandlers };
