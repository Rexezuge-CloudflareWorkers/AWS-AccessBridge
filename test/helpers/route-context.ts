import { vi } from 'vitest';
import type { ActivityContext, IEnv } from '@/endpoints/IActivityAPIRoute';

interface RouteContextOptions {
  body?: unknown;
  url?: string;
  method?: string;
  email?: string;
  env?: Record<string, unknown>;
}

function createRouteContext<TEnv extends IEnv>(options?: RouteContextOptions): ActivityContext<TEnv> {
  const { body = {}, url = 'https://example.com/user/test', method = 'GET', email = 'user@example.com', env = {} } = options ?? {};
  const raw =
    method === 'GET' || method === 'HEAD' ? new Request(url, { method }) : new Request(url, { method, body: JSON.stringify(body) });
  return {
    req: {
      json: async () => body,
      raw,
      method,
      url,
      header: () => undefined,
    },
    env: {
      AccessBridgeDB: { withSession: vi.fn().mockReturnValue({ mockSession: true }) },
      ...env,
    },
    get: vi.fn().mockReturnValue(email),
    header: vi.fn(),
    status: vi.fn(),
    json: vi.fn((value: unknown) => value),
    body: vi.fn((value: unknown) => value),
  } as unknown as ActivityContext<TEnv>;
}

export { createRouteContext };
export type { RouteContextOptions };
