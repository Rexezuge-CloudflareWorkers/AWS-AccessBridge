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
import { TokenAuthUtil } from '@aws-access-bridge/backend-services/auth/TokenAuthUtil';

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

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: waitUntilSpy,
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    AccessBridgeDB: { mock: true } as D1DatabaseSession,
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
    app.use('*', MiddlewareHandlers.activityAudit());
  }
  app.use('*', MiddlewareHandlers.userAuthentication());
  app.get('/user/test', async (c) => {
    return c.json({ email: c.get('AuthenticatedUserEmailAddress') });
  });
  return app;
}

function createApiApp(): TestApp {
  const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
  app.use('*', MiddlewareHandlers.apiAuthentication());
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
      app.use('*', MiddlewareHandlers.activityAudit());
      app.get('/api/test', async (c) => {
        c.set('AuthenticatedUserEmailAddress', 'user@example.com');
        return c.json({ ok: true }, 201);
      });

      const response: Response = await app.fetch(
        new Request('https://worker.example.com/api/test', {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
            'User-Agent': 'Vitest',
          },
        }),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      expect(auditLogConstructorSpy).toHaveBeenCalledWith({ mock: true });
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
      );
      expect(waitUntilSpy).toHaveBeenCalledTimes(1);
    });

    it('uses the first forwarded-for address for trusted Pages proxy audit logs', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      app.use('*', MiddlewareHandlers.activityAudit());
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
      );
    });

    it('ignores spoofed forwarded-for headers for direct audit logs', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      app.use('*', MiddlewareHandlers.activityAudit());
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
      );
    });

    it('writes an audit log entry with unknown user when authentication has not populated the context', async () => {
      const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
      app.use('*', MiddlewareHandlers.activityAudit());
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
      );
      expect(waitUntilSpy).toHaveBeenCalledTimes(1);
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
      const authenticateWithPATSpy = vi.spyOn(TokenAuthUtil, 'authenticateWithPAT').mockResolvedValue('pat@example.com');

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
      const authenticateWithPATSpy = vi.spyOn(TokenAuthUtil, 'authenticateWithPAT').mockResolvedValue('pat@example.com');

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
      expect(authenticateWithPATSpy).toHaveBeenCalledWith('test-token', { mock: true });
    });

    it('returns a 401 response when PAT authentication fails', async () => {
      const app: TestApp = createApiApp();
      vi.spyOn(TokenAuthUtil, 'authenticateWithPAT').mockRejectedValue(new UnauthorizedError('PAT rejected'));

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
