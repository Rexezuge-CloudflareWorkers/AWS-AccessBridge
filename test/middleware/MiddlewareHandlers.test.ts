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

import { MiddlewareHandlers } from '@/middleware';

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
        'user@example.com',
        'GET:/api/test',
        'GET',
        '/api/test',
        201,
        undefined,
        undefined,
        '203.0.113.10',
        'Vitest',
        null,
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
        'user@example.com',
        'GET:/api/test',
        'GET',
        '/api/test',
        200,
        undefined,
        undefined,
        '203.0.113.10',
        undefined,
        null,
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
        'user@example.com',
        'GET:/api/test',
        'GET',
        '/api/test',
        200,
        undefined,
        undefined,
        '192.0.2.10',
        undefined,
        null,
      );
    });

    it('writes an audit log entry with unknown user when authentication has not populated the context', async () => {
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
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        'unknown',
        'GET:/api/test',
        'GET',
        '/api/test',
        401,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
      );
      expect(waitUntilSpy).toHaveBeenCalledTimes(1);
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
      const recordedStatus = auditLogCreateSpy.mock.calls[0][4];
      expect(recordedStatus).toBeGreaterThanOrEqual(500);
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        'unknown',
        'GET:/api/test',
        'GET',
        '/api/test',
        recordedStatus,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
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

    it('returns a 401 response and audit log entry when authentication fails before route execution', async () => {
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
      expect(auditLogCreateSpy).toHaveBeenCalledWith(
        'unknown',
        'GET:/user/test',
        'GET',
        '/user/test',
        401,
        undefined,
        undefined,
        undefined,
        undefined,
        // No authenticated account, so no id: the entry is still written.
        null,
      );
      expect(waitUntilSpy).toHaveBeenCalledTimes(1);
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
