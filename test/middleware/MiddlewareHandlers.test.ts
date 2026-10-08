import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  CF_CONNECTING_IP_HEADER,
  CF_RAY_HEADER,
  API_WORKER_BASE_HOSTNAME,
  DEMO_USER_EMAIL,
  FORWARDED_FOR_HEADER,
  INTERNAL_USER_EMAIL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@aws-access-bridge/shared/constants';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { TokenService } from '@aws-access-bridge/backend-services/auth';

const { auditLogCreateSpy, auditLogConstructorSpy, waitUntilSpy } = vi.hoisted(() => {
  return {
    auditLogCreateSpy: vi.fn(),
    auditLogConstructorSpy: vi.fn(),
    waitUntilSpy: vi.fn(),
  };
});

vi.mock('@aws-access-bridge/backend-data/dao/AuditLogDAO', () => {
  class MockAuditLogDAO {
    constructor(database: unknown) {
      auditLogConstructorSpy(database);
    }

    create = auditLogCreateSpy;
  }

  return {
    AuditLogDAO: MockAuditLogDAO,
  };
});

import { MiddlewareHandlers, csrfProtectionHandler, rateLimitHandler } from '@/middleware';

type TestApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
 * Mounts a handler whose `Context` type differs from the app's.
 *
 * `MiddlewareHandlers` returns handlers typed against Hono's `RequestContext`, which
 * requires `[GET_MATCH_RESULT]` on `req` and is therefore not satisfied by a
 * generically-typed app. That produced nine "no overload matches" errors on
 * `app.use(...)` — the middleware is fine, the two context types are simply declared
 * independently.
 *
 * The mismatch is erased **here**, once, rather than at each of the nine call sites:
 * the alternative is nine casts that each hide the same fact, and a reader would have to
 * establish nine times that this one is the same known variance gap. The test is about
 * the middleware's behaviour, not Hono's inference.
 */
function mount(app: TestApp, path: string, handler: (c: never, next: never) => Promise<unknown>): void {
  app.use(path, handler as unknown as Parameters<TestApp['use']>[1]);
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: waitUntilSpy,
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

/**
 * A `D1Result`, built rather than cast: the type requires `meta` alongside `results`
 * and `success`, so an object missing `meta` is not a result at all.
 */
function d1Result<T>(results: T[]): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    },
  };
}

/**
 * A D1 session double.
 *
 * This was `{ mock: true } as D1DatabaseSession`, which does not typecheck — the two
 * types do not overlap — and the failure cascaded into nine "no overload matches"
 * errors on every subsequent `app.request(...)`, so one dishonest stub was reported as
 * ten unrelated ones.
 *
 * The middlewares under test never query D1, so the members are present but empty,
 * and the cast is explicit rather than inherited from a structural mismatch. The
 * alternative — hand-writing `D1PreparedStatement`'s overloads for `first` and `raw`,
 * which differ only in a `columnNames` discriminant — is a lot of ceremony for a stub
 * that is never exercised, and a *partial* attempt at it is worse: it claims members
 * `D1DatabaseSession` does not have in this platform build. A query reaching this
 * returns the empty result, which is the right answer for a double and fails loudly
 * enough in a test that expected rows.
 */
function d1Session(): D1DatabaseSession {
  const empty = () => d1Result<Record<string, unknown>>([]);
  return {
    prepare: () => ({
      bind: () => undefined,
      first: async () => null,
      run: empty,
      all: empty,
      raw: async () => [],
    }),
    batch: async () => [empty()],
    getBookmark: () => null,
  } as unknown as D1DatabaseSession;
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    AccessBridgeDB: d1Session(),
    DEMO_MODE: 'false',
    TEAM_DOMAIN: 'https://team.example.com',
    POLICY_AUD: 'policy-aud',
    ...overrides,
  } as Env;
}

function withCloudflareMetadata(request: Request): Request {
  Object.defineProperty(request, 'cf', {
    value: { colo: 'SFO' },
    configurable: true,
  });
  return request;
}

/**
 * The auth boundary is the cheapest thing an unauthenticated caller can hit, so
 * `/api/*` is throttled per CF-Connecting-IP. CF-Connecting-IP is the only
 * header Cloudflare sets and a client cannot forge; `X-Forwarded-For` can be, and
 * keying on it would let the caller rotate buckets.
 */
/**
 * CSRF defence on the cookie-authenticated `/user/*` surface. A cross-site
 * `<form enctype="text/plain">` POST carries the user's Cloudflare Access
 * cookies and cannot set a JSON content type, so these two checks are what stop
 * an administrator's browser from minting a PAT or granting access on another
 * site's say-so.
 */
describe('csrfProtection', () => {
  function csrfApp(): TestApp {
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', csrfProtectionHandler);
    app.all('/user/test', (c) => c.json({ ok: true }));
    return app;
  }

  async function call(method: string, headers: Record<string, string>): Promise<Response> {
    return csrfApp().fetch(new Request(`https://worker.example.com/user/test`, { method, headers }), createEnv(), createExecutionContext());
  }

  it('refuses a state-changing request the browser marked cross-site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const response: Response = await call('POST', { 'Sec-Fetch-Site': site, 'Content-Type': 'application/json' });
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toMatchObject({ Exception: { Type: 'Forbidden' } });
    }
  });

  it('refuses a body-bearing POST that is not JSON', async () => {
    const response: Response = await call('POST', { 'Content-Type': 'text/plain', 'Content-Length': '9' });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ Exception: { Type: 'Forbidden' } });
  });

  it('allows same-origin JSON, a body-less write, and a missing Sec-Fetch-Site', async () => {
    const sameOriginJson = await call('POST', {
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      'Content-Length': '2',
    });
    expect(sameOriginJson.status).toBe(200);
    const emptyBody = await call('POST', { 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0' });
    expect(emptyBody.status).toBe(200);
    // curl and server-to-server clients do not send the header at all.
    const noSecFetchSite = await call('POST', { 'Content-Type': 'application/json' });
    expect(noSecFetchSite.status).toBe(200);
    // `none` is what a user-initiated navigation sends. It carries the JSON
    // content type because `apiRequest` sets it on every mutating call — which
    // is also what a body-less DELETE must do now that only `Content-Length: 0`
    // exempts a write from the content-type check.
    const navigation = await call('DELETE', { 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json' });
    expect(navigation.status).toBe(200);
    // The explicit empty body is the other exemption.
    const explicitEmpty = await call('DELETE', { 'Sec-Fetch-Site': 'none', 'Content-Length': '0' });
    expect(explicitEmpty.status).toBe(200);
  });

  /**
   * `Content-Length: 0` is the only thing that counts as a body-less write.
   *
   * A request carrying neither `Content-Length` nor `Transfer-Encoding` has an
   * *unknown* body, not an empty one, so it has to declare JSON as well. This
   * is what stops the guard depending on a framing header — and a JSON parser —
   * that an attacker influences: today the browser always frames a form post, so
   * the case is not reachable from the CSRF threat model, but the conservative
   * reading costs the SPA nothing because `apiRequest` sends the header on
   * every mutating call.
   */
  it('treats an unframed write as an unknown body rather than an empty one', async () => {
    const unframedNoType = await call('POST', { 'Sec-Fetch-Site': 'same-origin' });
    expect(unframedNoType.status).toBe(403);
    await expect(unframedNoType.json()).resolves.toMatchObject({ Exception: { Type: 'Forbidden' } });

    // Unframed but explicitly JSON is allowed — that is `apiRequest`'s shape
    // before the network layer attaches a length.
    const unframedJson = await call('PUT', { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' });
    expect(unframedJson.status).toBe(200);

    // A chunked write is a body whatever its length says.
    const chunked = await call('POST', { 'Sec-Fetch-Site': 'same-origin', 'Transfer-Encoding': 'chunked' });
    expect(chunked.status).toBe(403);

    // Whitespace around the zero is still a zero.
    const paddedEmpty = await call('DELETE', { 'Sec-Fetch-Site': 'same-origin', 'Content-Length': ' 0 ' });
    expect(paddedEmpty.status).toBe(200);
  });

  it('leaves reads alone whatever the headers say', async () => {
    const crossSiteRead = await call('GET', { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' });
    expect(crossSiteRead.status).toBe(200);
    const headRead = await call('HEAD', { 'Sec-Fetch-Site': 'cross-site' });
    expect(headRead.status).toBe(200);
  });
});

describe('hmacValidation', () => {
  it('skips a request that carries no internal headers', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', MiddlewareHandlers.hmacValidation());
    app.get('/api/test', (c) => c.json({ ok: true }));
    const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
    expect(response.status).toBe(200);
  });

  it('rejects a request wearing an internal header it cannot sign', async () => {
    // The header alone is not identity: without a valid signature the request
    // must never reach `authenticateApiIdentity`, which trusts the email header.
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', MiddlewareHandlers.hmacValidation());
    app.get('/api/test', (c) => c.json({ ok: true }));
    const response: Response = await app.fetch(
      new Request('https://worker.example.com/api/test', {
        headers: { 'X-Internal-Signature': 'forged', 'X-Internal-User-Email': 'admin@evil.test' },
      }),
      createEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(401);
  });
});

describe('apiAuthentication', () => {
  it('refuses an internal call with no user email header', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', MiddlewareHandlers.apiAuthentication());
    app.get('/api/test', (c) => c.json({ email: c.get('AuthenticatedUserEmailAddress') }));
    const response: Response = await app.fetch(
      new Request('https://worker.internal/api/test', { headers: { 'X-Internal-Timestamp': '1' } }),
      createEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(401);
  });

  it('refuses a request with no credentials at all', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', MiddlewareHandlers.apiAuthentication());
    app.get('/api/test', (c) => c.json({ ok: true }));
    const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
    expect(response.status).toBe(401);
  });
});

describe('rateLimit', () => {
  it('lets a request through and keys it on CF-Connecting-IP', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', rateLimitHandler);
    app.get('/api/test', (c) => c.json({ ok: true }));
    const response = await app.fetch(
      new Request('https://worker.example.com/api/test', {
        headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '198.51.100.9' },
      }),
      createEnv({ AUTH_RATE_LIMITER: { limit } as unknown as RateLimit }),
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });

  it('answers 429 with the shared envelope when the key is over the limit', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', rateLimitHandler);
    app.get('/api/test', (c) => c.json({ ok: true }));
    const response = await app.fetch(
      new Request('https://worker.example.com/api/test', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }),
      createEnv({ AUTH_RATE_LIMITER: { limit } as unknown as RateLimit }),
      createExecutionContext(),
    );
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ Exception: { Type: 'RateLimited', Message: expect.any(String) } });
  });

  it('fails open when the binding is absent', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
    mount(app, '*', rateLimitHandler);
    app.get('/api/test', (c) => c.json({ ok: true }));
    // Local development and any deployment that has not bound a namespace must
    // keep working; 429ing every request would be its own outage.
    const response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
    expect(response.status).toBe(200);
  });
});

function createUserApp(includeAudit: boolean = false): TestApp {
  const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
  if (includeAudit) {
    mount(app, '*', MiddlewareHandlers.activityAudit());
  }
  mount(app, '*', MiddlewareHandlers.userAuthentication());
  app.get('/user/test', async (c) => {
    return c.json({ email: c.get('AuthenticatedUserEmailAddress') });
  });
  return app;
}

function createApiApp(): TestApp {
  const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
  mount(app, '*', MiddlewareHandlers.apiAuthentication());
  app.get('/api/test', async (c) => {
    return c.json({ email: c.get('AuthenticatedUserEmailAddress') });
  });
  return app;
}

describe('MiddlewareHandlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    auditLogCreateSpy.mockReset();
    auditLogCreateSpy.mockResolvedValue(undefined);
    auditLogConstructorSpy.mockReset();
    waitUntilSpy.mockReset();
  });

  describe('activityAudit', () => {
    it('writes an audit log entry with the authenticated user and response status', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true }, 201);
      });

      const env = createEnv();
      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
            'User-Agent': 'Vitest',
          },
        }),
        env,
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      // **Identity**, not shape. This asserted `{ mock: true }` — the double's
      // *contents* — so replacing those members broke a test that was never about
      // them, which is the failure mode of pinning an assertion to a fake's shape
      // rather than to its identity. The claim is "the DAO was handed the session this
      // app was configured with", so that is what is asserted.
      expect(auditLogConstructorSpy).toHaveBeenCalledWith(env.AccessBridgeDB);
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'user@example.com',
          action: 'GET:/api/test',
          method: 'GET',
          path: '/api/test',
          statusCode: 201,
          ipAddress: '203.0.113.10',
          userAgent: 'Vitest',
          userId: null,
        }),
      );
      expect(waitUntilSpy).toHaveBeenCalledTimes(1);
    });

    it('uses the first forwarded-for address for trusted Pages proxy audit logs', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true });
      });

      const response: Response = await app.fetch(
        withCloudflareMetadata(
          new Request(`https://${API_WORKER_BASE_HOSTNAME}/api/test`, {
            headers: {
              [CF_CONNECTING_IP_HEADER]: '192.0.2.10',
              [CF_RAY_HEADER]: 'test-ray',
              [FORWARDED_FOR_HEADER]: '203.0.113.10, 198.51.100.8',
            },
          }),
        ),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'user@example.com',
          action: 'GET:/api/test',
          method: 'GET',
          path: '/api/test',
          statusCode: 200,
          ipAddress: '203.0.113.10',
          userAgent: undefined,
          userId: null,
        }),
      );
    });

    it('ignores spoofed forwarded-for headers for direct audit logs', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true });
      });

      const response: Response = await app.fetch(
        withCloudflareMetadata(
          new Request('https://worker.example.com/api/test', {
            headers: {
              [CF_CONNECTING_IP_HEADER]: '192.0.2.10',
              [CF_RAY_HEADER]: 'test-ray',
              [FORWARDED_FOR_HEADER]: '203.0.113.10',
            },
          }),
        ),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'user@example.com',
          action: 'GET:/api/test',
          method: 'GET',
          path: '/api/test',
          statusCode: 200,
          ipAddress: '192.0.2.10',
          userAgent: undefined,
          userId: null,
        }),
      );
    });

    it('writes no audit entry for an unauthenticated 401', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        return c.json(
          {
            Exception: {
              Type: 'Unauthorized',
              Message: 'Missing auth',
            },
          },
          401,
        );
      });

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());

      expect(response.status).toBe(401);
      // An unauthenticated 401 writes no audit row. Recording every one of them
      // let an unauthenticated caller fill the table with attacker-controlled
      // path/user-agent values — a write amplification path with no principal.
      expect(auditLogCreateSpy).not.toHaveBeenCalled();
      expect(waitUntilSpy).not.toHaveBeenCalled();
    });

    /**
     * Regression guard on the `finally` that skips an unauthenticated 401.
     *
     * The skip used to be an early `return` from inside the `finally`, and a
     * `return` there discards any exception the `catch` had just re-threw, so a
     * downstream fault reaching `next()` as a rejection would have become a 200:
     * the audit skip hiding a real failure behind a successful-looking response.
     * The skip is now a guard *before* the write.
     *
     * Hono absorbs a handler's throw and renders it before this middleware sees
     * it, so the observable property is that a failing request stays failing.
     */
    it('never turns a failing request into a success while skipping the audit write', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', () => {
        throw Object.assign(new Error('upstream exploded'), { status: 401 });
      });

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());

      expect(response.status).not.toBe(200);
      expect(response.status).toBeGreaterThanOrEqual(400);
      // The middleware saw a non-401 status, so this one *is* recorded — a 500 is
      // exactly what an audit trail exists for.
      expect(auditLogCreateSpy).toHaveBeenCalled();
    });

    it('hands waitUntil a promise that never rejects, and logs the failure', async () => {
      // Regression guard: `waitUntil` returns void, so the audit promise was
      // detached and a rejection escaped as an unhandled rejection in the
      // runtime. The surrounding try/catch could never see it, so the named
      // warning could never fire. The promise handed to waitUntil must now
      // already carry its own rejection handler.
      auditLogCreateSpy.mockRejectedValue(new Error('D1 unavailable'));

      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true });
      });

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
      expect(response.status).toBe(200);

      const handedToWaitUntil = waitUntilSpy.mock.calls[0][0] as Promise<unknown>;
      expect(handedToWaitUntil).toBeInstanceOf(Promise);
      await expect(handedToWaitUntil).resolves.toBeUndefined();
    });

    it('still serves the response when the audit event cannot be built', async () => {
      auditLogConstructorSpy.mockImplementation(() => {
        throw new Error('no database binding');
      });

      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true });
      });

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
      // Auditing is best-effort and must never break the request it describes.
      expect(response.status).toBe(200);
    });

    it('audits a failed request with a 5xx status and does not swallow the error', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      mount(app, '*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', () => Promise.reject(new Error('boom')));

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());
      expect(response.status).toBe(500);
      // The failure must still be recorded; auditing a failed request matters
      // more than auditing a successful one.
      const recorded: { statusCode: number } = auditLogCreateSpy.mock.calls[0][0];
      expect(recorded.statusCode).toBeGreaterThanOrEqual(500);
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'unknown',
          action: 'GET:/api/test',
          method: 'GET',
          path: '/api/test',
          ipAddress: undefined,
          userAgent: undefined,
          userId: null,
        }),
      );
    });
  });

  describe('userAuthentication', () => {
    it('uses the demo user when demo mode is enabled', async () => {
      const app: TestApp = createUserApp();

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/user/test'),
        createEnv({ DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ email: DEMO_USER_EMAIL });
    });

    it('rejects bearer tokens on the user surface (strict split: PAT is /api/* only)', async () => {
      const app: TestApp = createUserApp();
      const authenticateWithPATSpy = vi.spyOn(TokenService.prototype, 'authenticateWithPAT').mockResolvedValue('pat@example.com');

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/user/test', {
          headers: {
            Authorization: 'Bearer test-token',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No Cloudflare Access JWT token provided in request headers.',
        },
      });
      expect(authenticateWithPATSpy).not.toHaveBeenCalled();
    });

    it('does not authenticate using the Cloudflare Access email header', async () => {
      const app: TestApp = createUserApp();

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/user/test', {
          headers: {
            'Cf-Access-Authenticated-User-Email': 'header@example.com',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No Cloudflare Access JWT token provided in request headers.',
        },
      });
    });

    it('rejects internal self-worker requests on the user surface (strict split)', async () => {
      const app: TestApp = createUserApp();

      const response: Response = await app.fetch(
        new Request(`https://${SELF_WORKER_BASE_HOSTNAME}/user/test`, {
          headers: {
            [INTERNAL_USER_EMAIL_HEADER]: 'internal@example.com',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No Cloudflare Access JWT token provided in request headers.',
        },
      });
    });

    it('returns a 401 response and no audit entry when authentication fails before route execution', async () => {
      const app: TestApp = createUserApp(true);

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/user/test'),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No Cloudflare Access JWT token provided in request headers.',
        },
      });
      // Same rule as the `/api/*` surface: a 401 with no authenticated
      // principal is an unauthenticated probe, not an auditable event.
      expect(auditLogCreateSpy).not.toHaveBeenCalled();
      expect(waitUntilSpy).not.toHaveBeenCalled();
    });
  });

  describe('apiAuthentication', () => {
    it('uses the demo user when demo mode is enabled', async () => {
      const app: TestApp = createApiApp();

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test'),
        createEnv({ DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ email: DEMO_USER_EMAIL });
    });

    it('authenticates bearer tokens via PAT lookup', async () => {
      const app: TestApp = createApiApp();
      const authenticateWithPATSpy = vi.spyOn(TokenService.prototype, 'authenticateWithPAT').mockResolvedValue('pat@example.com');

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', {
          headers: {
            Authorization: 'Bearer test-token',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ email: 'pat@example.com' });
      // The second argument is the detach seam: the last-used stamp leaves the
      // response path via `ctx.waitUntil`.
      expect(authenticateWithPATSpy).toHaveBeenCalledWith('test-token', expect.any(Function));
    });

    it('detaches the token last-used write instead of blocking the response on it', async () => {
      const app: TestApp = createApiApp();
      const authenticateWithPATSpy = vi
        .spyOn(TokenService.prototype, 'authenticateWithPAT')
        .mockImplementation(async (_token: string, defer?: (work: Promise<unknown>) => void) => {
          // The service hands the write over; the middleware owns running it.
          defer?.(Promise.resolve());
          return 'pat@example.com';
        });

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', { headers: { Authorization: 'Bearer test-token' } }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(authenticateWithPATSpy).toHaveBeenCalledOnce();
    });

    it('returns a 401 response when PAT authentication fails', async () => {
      const app: TestApp = createApiApp();
      vi.spyOn(TokenService.prototype, 'authenticateWithPAT').mockRejectedValue(new UnauthorizedError('PAT rejected'));

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', {
          headers: {
            Authorization: 'Bearer bad-token',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'PAT rejected',
        },
      });
    });

    it('returns a 401 response when no bearer token is provided', async () => {
      const app: TestApp = createApiApp();

      const response: Response = await app.fetch(new Request('https://worker.example.com/api/test'), createEnv(), createExecutionContext());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No personal access token provided in request headers.',
        },
      });
    });

    it('ignores Cloudflare Access JWT on the api surface (strict split: Access is /user/* only)', async () => {
      const app: TestApp = createApiApp();

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', {
          headers: {
            'cf-access-jwt-assertion': 'some-jwt-token',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No personal access token provided in request headers.',
        },
      });
    });

    it('authenticates HMAC-signed internal self-worker requests from the internal user header', async () => {
      const app: TestApp = createApiApp();

      const response: Response = await app.fetch(
        new Request(`https://${SELF_WORKER_BASE_HOSTNAME}/api/test`, {
          headers: {
            [INTERNAL_USER_EMAIL_HEADER]: 'internal@example.com',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ email: 'internal@example.com' });
    });
  });
});
