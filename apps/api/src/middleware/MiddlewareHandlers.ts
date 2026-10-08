import {
  DEMO_USER_EMAIL,
  DEFAULT_DEMO_MODE,
  INTERNAL_HEADER_PREFIX,
  INTERNAL_USER_EMAIL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@aws-access-bridge/shared/constants';
import { Context, Next } from 'hono';
import { HMACHandler } from './HMACHandler';
import { csrfProtectionHandler, noStoreHandler, rateLimitHandler } from './RequestGuards';
import { IServiceError, UnauthorizedError } from '@aws-access-bridge/backend-errors';

import type { AccessIdentityContext } from '@aws-access-bridge/backend-services/auth';

import { ErrorTranslationUtil } from '@aws-access-bridge/backend-services/error/ErrorTranslationUtil';
import { ReplayGuard } from '@aws-access-bridge/backend-services/auth/ReplayGuard';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { log } from '@aws-access-bridge/shared/utils';
type RequestContext = Context<{
  Bindings: Env;
  // `AuthenticatedUserEmailAddress` is the address the request authenticated as.
  // `AuthenticatedUserId` is the stable account key that address resolves to
  // (migration 0032), published alongside it so identity-keyed reads survive an
  // address change. Optional, and absent on a database without 0032.
  Variables: { AuthenticatedUserEmailAddress: string; AuthenticatedUserId?: string };
}>;
type AuthenticatedEnv = Env & {
  DEMO_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  AccessBridgeDB: D1DatabaseSession;
};

/**
The `{Exception: {Type, Message}}` envelope shared by every error response.
*/
function exceptionBody(error: IServiceError): { Exception: { Type: string; Message: string } } {
  return { Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } };
}

async function validateInternalRequest(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  // The scope exists even on the `*` middleware path (the WeakMap is keyed on
  // the Hono context), so the replay guard comes from the composition root like
  // every other collaborator — one place for its TTL-vs-window invariant.
  const replayGuard: ReplayGuard = getRequestScope(c).get(Tokens.ReplayGuard);
  await HMACHandler.validateInternalRequest(c, next, undefined, replayGuard);
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
  // Forward the Workers ExecutionContext so AccessAuthService can read the
  // platform-verified identity (`ctx.access`) when POLICY_AUD/TEAM_DOMAIN
  // are unset (Worker-level Access, same-account deploys).
  return getRequestScope(c)
    .get(Tokens.AccessAuthService)
    .getAuthenticatedUserEmail(c.req.raw, c.executionCtx as unknown as AccessIdentityContext);
}

function isInternalRequest(c: RequestContext): boolean {
  const url: URL = new URL(c.req.url);
  return url.hostname === SELF_WORKER_BASE_HOSTNAME || hasInternalHeadersFor(c.req.raw.headers);
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
    // Detached: the last-used stamp is a D1 write that must not sit on the auth
    // critical path, and `waitUntil` returns void, so the handler is attached to
    // the promise here rather than relying on the caller.
    const deferred = (work: Promise<unknown>): void => {
      c.executionCtx.waitUntil(
        work.catch((error: unknown): void => {
          log.error('Failed to update token last-used timestamp:', { error: error instanceof Error ? error.message : error });
        }),
      );
    };
    return getRequestScope(c).get(Tokens.TokenService).authenticateWithPAT(token, deferred);
  }
  throw new UnauthorizedError('No personal access token provided in request headers.');
}

async function activityAuditHandler(c: RequestContext, next: Next): Promise<void> {
  let statusCode: number = 200;
  let authenticatedEmail: string | undefined;

  try {
    await next();
    statusCode = c.res.status;
    authenticatedEmail = c.get('AuthenticatedUserEmailAddress');
  } catch (error: unknown) {
    statusCode = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    authenticatedEmail = c.get('AuthenticatedUserEmailAddress');
    throw error;
  } finally {
    // A 401 with no authenticated principal is an unauthenticated request:
    // recording each of them writes attacker-controlled "unknown" rows and
    // turns the audit table into an amplification target. Genuine 401s after
    // a successful handshake keep their entry.
    //
    // This is a guard *before* the write, deliberately not an early `return` from
    // inside this `finally`: a `return` here discards the exception the `catch`
    // just re-threw, so a real fault would surface as a 200. Nothing follows the
    // guard, so a `return` would happen to be safe — but only by coincidence of
    // ordering, and `no-unsafe-finally` is not enabled here to catch the day
    // someone appends a line below it.
    if (statusCode !== 401 || authenticatedEmail) {
      writeAuditEntry(c, statusCode, authenticatedEmail);
    }
  }
}

/**
 * Record one request in the audit trail. Failures are logged, never propagated:
 * a rejected audit write must not become an unhandled rejection, and must not
 * fail the request it describes.
 *
 * Synchronous by design, so the caller's `finally` never awaits and therefore
 * never has to reason about how an await there interacts with the exception the
 * `catch` above re-threw.
 */
function writeAuditEntry(c: RequestContext, statusCode: number, authenticatedEmail: string | undefined): void {
  try {
    const userEmail: string = authenticatedEmail || 'unknown';
    // The stable account id, so the entry stays findable after the account
    // changes address. Optional: a database without 0032 leaves it unset and
    // the entry is written address-keyed, exactly as before.
    const userId: string | null = c.get('AuthenticatedUserId') ?? null;
    const auditService = getRequestScope(c).get(Tokens.AuditService);
    const event = auditService.buildRequestEvent(c.req.raw, userEmail, statusCode, c.env, userId);
    // `waitUntil` returns void, so the promise it is handed is detached: a
    // rejection here would escape as an unhandled rejection in the runtime
    // rather than reach the catch below. Attach the handler to the promise.
    c.executionCtx.waitUntil(
      auditService.record(event).catch((auditError: unknown): void => {
        log.error('Failed to write audit log:', { error: auditError });
      }),
    );
  } catch (error: unknown) {
    log.error('Failed to build audit log event:', { error: error });
  }
}

/**
 * Publish the authenticated account's stable id next to its address.
 *
 * Best-effort by design: the id is an optimisation that lets identity-keyed
 * reads survive an address change, and the address alone remains a complete
 * identity on a database that has not run 0032. So a failure here (a missing
 * table, an unknown account) leaves the request authenticated rather than
 * rejecting it — logging and continuing is the correct trade for a key that is
 * only a faster path to the same answer.
 */
async function publishAccountId(c: RequestContext, userEmail: string): Promise<void> {
  try {
    const identity = getRequestScope(c).get(Tokens.UserIdentityService);
    const userId: string | null = await identity.resolveUserId(userEmail);
    if (userId) {
      c.set('AuthenticatedUserId', userId);
    }
  } catch (error: unknown) {
    log.warn('Could not resolve authenticated user id:', { error: error instanceof Error ? error.message : error });
  }
}

/**
 * Authenticate, publish the principal, and run the rest of the chain, translating
 * an `IServiceError` into its typed JSON response.
 *
 * Shared by the `/user/*` and `/api/*` handlers, which differ only in *how* they
 * authenticate. The translation used to be copy-pasted across both, so a change
 * to either shape had to be made twice.
 */
async function authenticateAndContinue(
  c: RequestContext,
  next: Next,
  authenticate: (context: RequestContext) => Promise<string>,
): Promise<Response | void> {
  try {
    const userEmail: string = await authenticate(c);
    c.set('AuthenticatedUserEmailAddress', userEmail);
    await publishAccountId(c, userEmail);
    await next();
  } catch (error: unknown) {
    if (error instanceof IServiceError) {
      return c.json(exceptionBody(error), error.getErrorCode());
    }
    throw error;
  }
}

async function userAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  return authenticateAndContinue(c, next, authenticateUserIdentity);
}

async function apiAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  return authenticateAndContinue(c, next, authenticateApiIdentity);
}

class MiddlewareHandlers {
  public static csrfProtection(): (c: Context<{ Bindings: Env }>, next: Next) => Promise<Response | void> {
    return csrfProtectionHandler;
  }

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

  public static noStore(): (c: Context<{ Bindings: Env }>, next: Next) => Promise<void> {
    return noStoreHandler;
  }

  public static rateLimit(): (c: Context<{ Bindings: Env }>, next: Next) => Promise<Response | void> {
    return rateLimitHandler;
  }

  public static userAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return userAuthenticationHandler;
  }

  public static apiAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return apiAuthenticationHandler;
  }

  private static withErrorTranslation<T extends unknown[], R>(fn: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
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
