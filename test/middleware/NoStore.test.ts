import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiddlewareHandlers } from '@/middleware/MiddlewareHandlers';
import { AccessBridgeWorker } from '@/workers/AccessBridgeWorker';

interface RecordedHeader {
  name: string;
  value: string;
}

/**
 * `/user/*` and `/api/*` responses carry AWS `SecretAccessKey`/`SessionToken`, a
 * 15-minute pre-authenticated console URL, and account and audit data. Without an
 * explicit `Cache-Control` an intermediary or the browser back/forward cache can
 * replay any of it after the request that produced it.
 */
function createApp(): { app: { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> }; headers: RecordedHeader[] } {
  const headers: RecordedHeader[] = [];
  const app = {
    fetch: async (request: Request, env: unknown, ctx: unknown): Promise<Response> => {
      const noStore = MiddlewareHandlers.noStore();
      return noStore(
        {
          req: { url: request.url, header: (name: string) => request.headers.get(name) ?? undefined },
          env,
          executionCtx: ctx,
          header: (name: string, value: string) => headers.push({ name, value }),
        } as never,
        async () => undefined,
      );
    },
  };
  return { app, headers };
}

function createExecutionContext(): unknown {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}

function createRouteDb(): unknown {
  const chain = {
    bind: () => ({
      run: async () => ({ success: true }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  };
  return { withSession: () => createRouteDb(), prepare: () => chain };
}

describe('MiddlewareHandlers.noStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['Cache-Control', 'no-store, max-age=0'],
    ['Pragma', 'no-cache'],
  ])('sets %s', async (name, value) => {
    const { app, headers } = createApp();
    await app.fetch(new Request('https://worker.example.com/api/test'), { DEMO_MODE: 'true' }, createExecutionContext());
    expect(headers).toContainEqual({ name, value });
  });

  it('sets the headers after the route has produced a response', async () => {
    const order: string[] = [];
    await MiddlewareHandlers.noStore()({ header: () => order.push('header') } as never, async () => {
      order.push('next');
    });
    expect(order).toEqual(['next', 'header', 'header']);
  });

  it('still sets the headers when a later handler returns without calling next', async () => {
    // The reason it is registered first: an authentication failure returns its
    // JSON directly rather than calling `next()`, so a middleware placed after
    // the auth handlers would never run on that path.
    const headers: RecordedHeader[] = [];
    await MiddlewareHandlers.noStore()(
      { header: (name: string, value: string) => headers.push({ name, value }) } as never,
      async () => undefined,
    );
    expect(headers.map((entry) => entry.name)).toEqual(['Cache-Control', 'Pragma']);
  });
});

describe('AccessBridgeWorker cache headers', () => {
  it('marks an /api/* response no-store through the real middleware chain', async () => {
    // Proves the header reaches a caller through the assembled app, rather than
    // only that `noStore` sets it in isolation.
    const worker = new AccessBridgeWorker();
    const response: Response = await worker.fetch(
      new Request('https://worker.example.com/api/aws/assume-role', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: JSON.stringify({ principalArn: 'arn:aws:iam::123456789012:role/Dev' }),
      }),
      { AccessBridgeDB: createRouteDb(), DEV_AUTH_EMAIL: 'dev@example.com' } as unknown as Env,
      createExecutionContext(),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
  });

  it('marks an /user/* response no-store', async () => {
    const worker = new AccessBridgeWorker();
    const response: Response = await worker.fetch(
      new Request('https://worker.example.com/user/me', { headers: { Authorization: 'Bearer test-token' } }),
      { AccessBridgeDB: createRouteDb(), DEV_AUTH_EMAIL: 'dev@example.com' } as unknown as Env,
      createExecutionContext(),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });
});