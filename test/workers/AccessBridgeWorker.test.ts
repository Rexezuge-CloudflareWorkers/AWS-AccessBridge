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
  describe('SPA catch-all', () => {
    it('does not serve the SPA by default', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(new Request('https://worker.example.com/'), createEnv(), createExecutionContext());

      expect(response.status).toBe(404);
    });

    it('serves the SPA when SERVE_SPA_FROM_WORKER is enabled', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/'),
        createEnv({ SERVE_SPA_FROM_WORKER: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('AWS AccessBridge');
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
