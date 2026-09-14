import { describe, expect, it, vi } from 'vitest';
import { AccessBridgeWorker } from '@/workers/AccessBridgeWorker';

type TestEnv = Env & {
  SERVE_SPA_FROM_WORKER?: string;
};

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function createRouteDb(): unknown {
  const chain = {
    bind: () => ({
      run: async () => ({ success: true }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  };
  return {
    withSession: () => createRouteDb(),
    prepare: () => chain,
  };
}

function createEnv(overrides: Partial<TestEnv> = {}): Env {
  return {
    AccessBridgeDB: createRouteDb(),
    ...overrides,
  } as unknown as Env;
}

describe('AccessBridgeWorker', () => {
  describe('canonical redirects (Otter parity)', () => {
    it('redirects root visits to the user console', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(new Request('https://worker.example.com/'), createEnv(), createExecutionContext());

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/user/');
    });

    it('redirects /user to /user/ preserving query', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/user?foo=bar'),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/user/?foo=bar');
    });

    it('redirects legacy page routes to /user/app/* preserving query', async () => {
      const worker = new AccessBridgeWorker();

      for (const [legacy, canonical] of [
        ['/costs', '/user/app/costs'],
        ['/resources', '/user/app/resources'],
        ['/admin', '/user/app/admin'],
      ] as const) {
        const response: Response = await worker.fetch(
          new Request(`https://worker.example.com${legacy}?x=1`),
          createEnv(),
          createExecutionContext(),
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(`${canonical}?x=1`);
      }
    });
  });

  describe('SPA catch-all', () => {
    it('does not serve the SPA by default', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/unknown-page-xyz'),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
    });

    it('serves the SPA for /user/ page routes when SERVE_SPA_FROM_WORKER is enabled (demo bypasses Access)', async () => {
      const worker = new AccessBridgeWorker();

      for (const path of ['/user/', '/user/app/', '/user/app/costs', '/user/app/resources', '/user/app/admin', '/user/app/admin/teams']) {
        const response: Response = await worker.fetch(
          new Request(`https://worker.example.com${path}`),
          createEnv({ SERVE_SPA_FROM_WORKER: 'true', DEMO_MODE: 'true' }),
          createExecutionContext(),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain('AWS AccessBridge');
      }
    });

    it('never serves the SPA for non-/user/ page paths', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/unknown-page-xyz'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true', DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
    });

    it('never serves the SPA for unknown /user/* paths (auth rejects first)', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/user/unknown-route-xyz'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
    });

    it('never serves the SPA for unknown /api/* paths (auth rejects first)', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/api/unknown-route-xyz'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });

  describe('user/api split', () => {
    it('GET /user/me without auth returns 401 JSON, never SPA HTML', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/user/me'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({
        Exception: {
          Type: 'Unauthorized',
          Message: 'No Cloudflare Access JWT token provided in request headers.',
        },
      });
    });

    it('GET /user/me in demo mode returns JSON user info (route wins over SPA catch-all)', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/user/me'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true', DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = (await response.json()) as { email: string; isSuperAdmin: boolean; demoMode: boolean };
      expect(body.demoMode).toBe(true);
      expect(typeof body.email).toBe('string');
    });
  });
});
