import { describe, expect, it, vi } from 'vitest';
import { AccessBridgeWorker } from '@/workers/AccessBridgeWorker';

type TestEnv = Env;

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

/**
 * A deliberately minimal environment.
 *
 * The worker's entry point is typed `CloudflareEnv`, which the generator pins to the
 * template's exact values — `POLICY_AUD` is the literal
 * `"you-cloudflare-zero-trust-application-aud"`, not `string`. So a test env built to
 * exercise routing or auth can never satisfy it field-for-field, and every
 * `worker.fetch(request, createEnv())` reported `Argument of type 'Env' is not
 * assignable to parameter of type 'CloudflareEnv'` — twelve errors in this file that
 * were all one missing cast in one factory.
 *
 * The cast is here rather than at the call sites for the reason it usually is: it is
 * one known boundary, and a reader can establish once that these tests are about the
 * worker's behaviour rather than about configuration completeness.
 */
function createEnv(overrides: Partial<TestEnv> = {}): CloudflareEnv {
  return {
    AccessBridgeDB: createRouteDb(),
    ...overrides,
  } as unknown as CloudflareEnv;
}

describe('AccessBridgeWorker', () => {
  describe('no manual scheduled trigger', () => {
    /**
     * `/__scheduled` used to run the privileged cron pipeline (real AWS calls with
     * stored credentials, D1 writes, retention pruning) before any route
     * middleware, behind its own bespoke auth gate. The pipeline is now reachable
     * only from Cloudflare's `triggers.crons`, so the HTTP surface has no way into
     * it at all — these assert the path is simply gone rather than gated.
     */
    it.each(['', '?cron=*%2F10+*+*+*+*'])('404s /__scheduled%s and never runs the pipeline', async (query) => {
      const worker = new AccessBridgeWorker();
      const scheduled = vi.spyOn(worker as unknown as { scheduled: () => Promise<void> }, 'scheduled');

      const response: Response = await worker.fetch(
        new Request(`https://worker.example.com/__scheduled${query}`, { method: 'POST' }),
        createEnv({ DEV_AUTH_EMAIL: 'regular@example.com' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
      expect(scheduled).not.toHaveBeenCalled();
    });

    it('404s the trigger even for a super-admin identity', async () => {
      const worker = new AccessBridgeWorker();
      const scheduled = vi.spyOn(worker as unknown as { scheduled: () => Promise<void> }, 'scheduled');

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/__scheduled', { method: 'POST' }),
        createEnv({ DEV_AUTH_EMAIL: 'admin@example.com' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
      expect(scheduled).not.toHaveBeenCalled();
    });
  });

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

    it('serves the SPA for /user/ page routes (demo bypasses Access)', async () => {
      const worker = new AccessBridgeWorker();

      for (const path of ['/user/', '/user/app/', '/user/app/costs', '/user/app/resources', '/user/app/admin', '/user/app/admin/teams']) {
        const response: Response = await worker.fetch(
          new Request(`https://worker.example.com${path}`),
          createEnv({ DEMO_MODE: 'true' }),
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
        createEnv({ DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
    });

    it('never serves the SPA for unknown /user/* paths (auth rejects first)', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/user/unknown-route-xyz'),
        createEnv(),
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
    });

    it('never serves the SPA for unknown /api/* paths (auth rejects first)', async () => {
      const worker = new AccessBridgeWorker();

      const response: Response = await worker.fetch(
        new Request('https://worker.example.com/api/unknown-route-xyz'),
        createEnv(),
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
        createEnv(),
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
        createEnv({ DEMO_MODE: 'true' }),
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body: { demoMode?: unknown; email?: unknown } = await response.json();
      expect(body.demoMode).toBe(true);
      expect(typeof body.email).toBe('string');
    });
  });

  describe('scheduled', () => {
    /**
     * The cron fans into the `CRON_TASKS` Durable Object over its own fetch. A 202
     * `already_running` means a tick was skipped; a run that wedges makes every
     * tick answer that way, so the skip has to be visible at `warn`, not buried
     * as an expected status.
     */
    async function runScheduled(status: number, body: string): Promise<void> {
      const waited: Array<Promise<unknown>> = [];
      const ctx = {
        passThroughOnException: vi.fn(),
        waitUntil: (promise: Promise<unknown>): void => {
          waited.push(promise);
        },
      } as unknown as ExecutionContext;
      const stub = { fetch: vi.fn().mockResolvedValue(new Response(body, { status })) };
      const env = createEnv({ CRON_TASKS: { get: () => stub, idFromName: () => ({}) } as unknown as Env['CRON_TASKS'] });
      await new AccessBridgeWorker().scheduled({ cron: '*/10 * * * *', noRetry: vi.fn(), scheduledTime: 1 }, env, ctx);
      await Promise.all(waited);
    }

    it('logs a skipped (202 already_running) tick at warn level', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await runScheduled(202, '{"status":"already_running"}');
      expect(warn).toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      warn.mockRestore();
      error.mockRestore();
    });

    it('stays quiet on a completed run', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await runScheduled(200, '{"status":"completed"}');
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      warn.mockRestore();
      error.mockRestore();
    });

    it('logs an error response at error level', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await runScheduled(500, '{"status":"failed"}');
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
