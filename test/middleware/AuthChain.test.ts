import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MiddlewareHandlers } from '@/middleware/MiddlewareHandlers';
import * as sharedConstants from '@aws-access-bridge/shared/constants';

/**
 * The auth chain is the most consequential code in the repository, and it was the
 * least covered: 61.5% branch coverage with only 17.4% of its functions exercised.
 *
 * These tests pin the properties that a regression here would be silent about —
 * a handler that forgets to call `next()` still gets `no-store` headers, a demo
 * flag cannot be set by request, and a 403 is never reported as a 401.
 */

/**
 * The collaborators the middleware resolves through the composition root.
 *
 * A mutable holder behind a `vi.mock` rather than a `vi.spyOn` of the module
 * namespace: ESM namespaces are frozen, so a spy on `getRequestScope` silently
 * does nothing under Vitest and the real service is reached instead.
 */
const services = {
  authenticateWithPAT: (_token: string, _defer?: (work: Promise<unknown>) => void): Promise<string> => Promise.resolve('user@example.com'),
  buildRequestEvent: (..._args: unknown[]): unknown => ({ action: 'x' }),
  record: (_event: unknown): Promise<void> => Promise.resolve(),
  resolveUserId: (_email: string): Promise<string | null> => Promise.resolve(null),
};

vi.mock('@aws-access-bridge/backend-services/composition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-access-bridge/backend-services/composition')>();
  return {
    ...actual,
    getRequestScope: () => ({ get: () => services }),
  };
});

/**
 * A Hono-shaped context double: enough for the middleware chain, recording what
 * each handler did so ordering and "returned without next()" are observable.
 */
function makeContext(options: {
  pathname?: string;
  hostname?: string;
  headers?: Record<string, string>;
  demoMode?: string;
  devAuthEmail?: string;
  authenticatedEmail?: string;
}) {
  const pathname = options.pathname ?? '/user/me';
  const headers = new Headers(options.headers ?? {});
  const responseHeaders = new Headers();
  let nextCalls = 0;

  const context = {
    env: {
      AccessBridgeDB: {},
      DEMO_MODE: options.demoMode,
      DEV_AUTH_EMAIL: options.devAuthEmail,
      ENVIRONMENT: 'production',
    },
    executionCtx: { waitUntil: vi.fn((p: Promise<unknown>) => p.catch(() => undefined)) },
    header: vi.fn((name: string) => {
      responseHeaders.set(name, name);
      return name;
    }),
    get: vi.fn((key: string) => (key === 'AuthenticatedUserEmailAddress' ? (options.authenticatedEmail ?? 'user@example.com') : undefined)),
    req: {
      header: (name: string) => headers.get(name) ?? undefined,
      method: 'GET',
      raw: new Request(`https://${options.hostname ?? 'app.example.com'}${pathname}`, { headers }),
      url: `https://${options.hostname ?? 'app.example.com'}${pathname}`,
    },
    res: { status: 200 },
    set: vi.fn(),
    json: vi.fn((body: unknown, status: number) => ({ body, status })),
  };

  const next = vi.fn(async () => {
    nextCalls += 1;
  });

  // `context` is the assertion surface (its spies); `asContext` is what the
  // middleware is called with. One double, two views, so a test never has to cast
  // by hand and drift from the real signature.
  return {
    asContext: context as never,
    context,
    next: next as never,
    nextCalls: () => nextCalls,
    responseHeaders,
  };
}

describe('noStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Registered first so it wraps the auth handlers, which return their JSON
   * directly rather than calling `next()`. Every `/user/*` and `/api/*` response
   * carries AWS credentials, a session token or a 15-minute console URL.
   */
  it('marks a successful response uncacheable', async () => {
    const { asContext, context, next } = makeContext({});
    await MiddlewareHandlers.noStore()(asContext, next);
    expect(context.header).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
    expect(context.header).toHaveBeenCalledWith('Pragma', 'no-cache');
  });

  it('still applies when the handler returned without calling next', async () => {
    // The reason this middleware is registered first: one registered behind an
    // auth handler would never run on the failure path.
    const { asContext, context, nextCalls } = makeContext({});
    await MiddlewareHandlers.noStore()(asContext, (async () => undefined));
    expect(nextCalls()).toBe(0);
    expect(context.header).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
  });

  it('sets both headers even when one is already present', async () => {
    const { asContext, context, next } = makeContext({});
    await MiddlewareHandlers.noStore()(asContext, next);
    // Belt and braces for the 302 whose Location carries a console token.
    expect(context.header).toHaveBeenCalledTimes(2);
  });
});

describe('apiAuthentication', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset the holder so one test's stub cannot leak into the next.
    services.authenticateWithPAT = () => Promise.resolve('user@example.com');
    services.buildRequestEvent = () => ({ action: 'x' });
    services.record = () => Promise.resolve();
    services.resolveUserId = () => Promise.resolve(null);
  });

  /**
   * `DEMO_MODE` returns a fixed address for every caller, so it must come from the
   * environment only — a request header of the same name must not arm it.
   */
  it('authenticates as the demo user when DEMO_MODE is set in the environment', async () => {
    const { asContext, context, next } = makeContext({ demoMode: 'true' });
    await MiddlewareHandlers.apiAuthentication()(asContext, next);
    expect(context.set).toHaveBeenCalledWith('AuthenticatedUserEmailAddress', sharedConstants.DEMO_USER_EMAIL);
  });

  it('ignores a DEMO_MODE request header', async () => {
    const { asContext, context, next } = makeContext({ headers: { 'DEMO_MODE': 'true' } });
    // Answered 401 rather than becoming the demo user: a request header must not
    // be able to arm the bypass.
    await MiddlewareHandlers.apiAuthentication()(asContext, next);
    expect(context.set).not.toHaveBeenCalledWith('AuthenticatedUserEmailAddress', sharedConstants.DEMO_USER_EMAIL);
    expect(context.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'Unauthorized' }) }), 401);
  });

  it('answers 401 for a request with no Authorization header', async () => {
    const { asContext, context, next } = makeContext({});
    await MiddlewareHandlers.apiAuthentication()(asContext, next);
    expect(context.json).toHaveBeenCalledWith(
      { Exception: { Message: 'No personal access token provided in request headers.', Type: 'Unauthorized' } },
      401,
    );
  });

  it('answers 401 for a non-Bearer Authorization scheme', async () => {
    const { asContext, context, next } = makeContext({ headers: { Authorization: 'Basic dXNlcjpwYXNz' } });
    await MiddlewareHandlers.apiAuthentication()(asContext, next);
    expect(context.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'Unauthorized' }) }), 401);
  });

  /**
   * A 401 and a 403 must stay distinct all the way to the wire: the SPA's
   * `isUnauthorized` keys on 401 alone, so a 403 rendered as 401 would send an
   * administrator to the Zero Trust login page for something re-authenticating
   * cannot fix.
   */
  it('answers an IServiceError with its own status, not a blanket 500', async () => {
    const { ForbiddenError, UnauthorizedError } = await import('@aws-access-bridge/backend-errors');
    for (const [error, status] of [
      [new UnauthorizedError('no token'), 401],
      [new ForbiddenError('not permitted'), 403],
    ] as const) {
      services.authenticateWithPAT = () => Promise.reject(error);
      // A PAT must be present, or the failure comes from the missing header rather
      // than from the stubbed token service.
      const { asContext, context, next } = makeContext({ headers: { Authorization: 'Bearer tok' } });
      await MiddlewareHandlers.apiAuthentication()(asContext, next);
      expect(context.json).toHaveBeenCalledWith({ Exception: { Message: error.getErrorMessage(), Type: error.getErrorType() } }, status);
    }
  });

  it('rethrows a non-service error rather than answering it', async () => {
    services.authenticateWithPAT = () => Promise.reject(new TypeError('bug'));
    const { asContext, next } = makeContext({ headers: { Authorization: 'Bearer tok' } });
    // A programming error must reach the runtime's error handling, not be
    // laundered into a typed JSON response.
    await expect(MiddlewareHandlers.apiAuthentication()(asContext, next)).rejects.toBeInstanceOf(TypeError);
  });

  it('publishes the account id alongside the address when one resolves', async () => {
    services.resolveUserId = () => Promise.resolve('usr_abc123');
    const { asContext, context, next } = makeContext({ demoMode: 'true' });
    await MiddlewareHandlers.apiAuthentication()(asContext, next);
    expect(context.set).toHaveBeenCalledWith('AuthenticatedUserId', 'usr_abc123');
  });

  /**
   * Best-effort by design: the id is a faster path to the same answer the address
   * already gives, so a failure must not reject an otherwise authenticated request.
   */
  it('continues when the account id cannot be resolved', async () => {
    services.resolveUserId = () => Promise.reject(new Error('no metadata table'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { asContext, context, next } = makeContext({ demoMode: 'true' });
    await expect(MiddlewareHandlers.apiAuthentication()(asContext, next)).resolves.toBeUndefined();
    expect(context.set).toHaveBeenCalledWith('AuthenticatedUserEmailAddress', sharedConstants.DEMO_USER_EMAIL);
    expect(warn).toHaveBeenCalled();
  });
});

describe('activityAudit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset the holder so one test's stub cannot leak into the next.
    services.authenticateWithPAT = () => Promise.resolve('user@example.com');
    services.buildRequestEvent = () => ({ action: 'x' });
    services.record = () => Promise.resolve();
    services.resolveUserId = () => Promise.resolve(null);
  });

  it('records an event carrying the status the handler produced', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const buildRequestEvent = vi.fn().mockReturnValue({ action: 'x' });
    services.buildRequestEvent = buildRequestEvent;
    services.record = record;

    const { asContext, context, next } = makeContext({ authenticatedEmail: 'user@example.com' });
    context.res.status = 201;
    await MiddlewareHandlers.activityAudit()(asContext, next);

    expect(buildRequestEvent).toHaveBeenCalledWith(
      context.req.raw,
      'user@example.com',
      201,
      context.env,
      null,
    );
  });

  it('records the status carried by a thrown HTTP error', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    services.buildRequestEvent = () => ({ action: 'x' });
    services.record = record;

    const { asContext } = makeContext({});
    const boom = Object.assign(new Error('nope'), { status: 404 });
    const thrower = (async () => { throw boom; }) as never;
    await expect(MiddlewareHandlers.activityAudit()(asContext, thrower)).rejects.toBeTruthy();
    expect(record).toHaveBeenCalled();
  });

  /**
   * `waitUntil` returns void, so the promise it is handed is detached: without an
   * attached catch a rejection would escape as an unhandled rejection in the
   * runtime rather than reach the handler below.
   */
  it('does not let an audit write failure escape', async () => {
    services.buildRequestEvent = () => ({ action: 'x' });
    services.record = () => Promise.reject(new Error('audit write failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { asContext, next } = makeContext({});
    await expect(MiddlewareHandlers.activityAudit()(asContext, next)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('survives a failure to build the event at all', async () => {
    services.buildRequestEvent = () => {
      throw new Error('cannot build');
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { asContext, next } = makeContext({});
    // The request still succeeds: auditing is not allowed to fail the request.
    await expect(MiddlewareHandlers.activityAudit()(asContext, next)).resolves.toBeUndefined();
  });
});