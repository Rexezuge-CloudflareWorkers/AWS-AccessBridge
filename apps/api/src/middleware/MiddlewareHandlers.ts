import {
  DEMO_USER_EMAIL,
  DEFAULT_DEMO_MODE,
  INTERNAL_HEADER_PREFIX,
  INTERNAL_USER_EMAIL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@aws-access-bridge/shared/constants';
import { Context, Next } from 'hono';
import { HMACHandler } from './HMACHandler';
import { IServiceError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { AccessAuthServiceFactory, TokenServiceFactory } from '@aws-access-bridge/backend-services/auth';
import { AuditServiceFactory } from '@aws-access-bridge/backend-services/audit';
import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';

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
  return AccessAuthServiceFactory.create(env).getAuthenticatedUserEmail(c.req.raw);
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
    return TokenServiceFactory.create(env).authenticateWithPAT(token);
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
      const userEmail: string = c.get('AuthenticatedUserEmailAddress') || 'unknown';
      const auditService = AuditServiceFactory.create({ AccessBridgeDB: c.env.AccessBridgeDB });
      const event = auditService.buildRequestEvent(c.req.raw, userEmail, statusCode, c.env);
      c.executionCtx.waitUntil(auditService.record(event));
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
