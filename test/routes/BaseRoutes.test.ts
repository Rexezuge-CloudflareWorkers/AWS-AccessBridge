import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import { BadRequestError, DatabaseError, MethodNotAllowedError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';

vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

interface TestResponse extends IResponse {
  ok: boolean;
}

class OkRoute extends IActivityAPIRoute<IRequest, TestResponse, IEnv> {
  protected async handleRequest(): Promise<TestResponse> {
    return { ok: true };
  }
}

class RawRoute extends IActivityAPIRoute<IRequest, TestResponse, IEnv> {
  protected async handleRequest() {
    return { rawBody: 'plain-text', statusCode: 200 as const, headers: { 'content-type': 'text/plain' } };
  }
}

class FailRoute extends IActivityAPIRoute<IRequest, TestResponse, IEnv> {
  constructor(private readonly error: unknown) {
    super({} as never);
  }

  protected async handleRequest(): Promise<TestResponse> {
    throw this.error;
  }
}

class AdminOkRoute extends IAdminActivityAPIRoute<IRequest, TestResponse, IEnv> {
  protected async handleAdminRequest(): Promise<TestResponse> {
    return { ok: true };
  }
}

function createContext(): ActivityContext<IEnv> {
  return {
    req: {
      json: async () => ({}),
      raw: new Request('https://example.com/user/test'),
      method: 'GET',
      url: 'https://example.com/user/test',
      header: () => undefined,
    },
    env: {
      AccessBridgeDB: { withSession: vi.fn().mockReturnValue({ mockSession: true }) },
    },
    get: vi.fn().mockReturnValue('user@example.com'),
    header: vi.fn(),
    status: vi.fn(),
    json: vi.fn((value: unknown) => value),
    body: vi.fn((value: unknown) => value),
  } as unknown as ActivityContext<IEnv>;
}

describe('IActivityAPIRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns plain object responses as JSON', async () => {
    const c = createContext();
    await new OkRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith({ ok: true });
  });

  it('passes rawBody responses through as body', async () => {
    const c = createContext();
    await new RawRoute({} as never).handle(c);
    expect(c.body).toHaveBeenCalledWith('plain-text');
    expect(c.header).toHaveBeenCalledWith('content-type', 'text/plain');
  });

  it('maps client errors to their type and code', async () => {
    const c = createContext();
    await new FailRoute(new BadRequestError('bad input')).handle(c);
    expect(c.json).toHaveBeenCalledWith({ Exception: { Type: new BadRequestError('x').getErrorType(), Message: 'bad input' } }, 400);
  });

  it('does not leak raw database error text to the client', async () => {
    // DatabaseError messages embed the underlying D1/SQLite text (table and
    // column names, constraint names, statement offsets), so a 5xx must fall
    // through to the same generic body as any other server-side fault.
    const c = createContext();
    await new FailRoute(new DatabaseError('D1_ERROR: SELECT * FROM credentials: SQLITE_ERROR: no such column: secret at offset 42')).handle(c);
    expect(c.json).toHaveBeenCalledWith({ Exception: { Type: expect.any(String), Message: expect.not.stringContaining('SQLITE_ERROR') } }, 500);
    expect(c.json).toHaveBeenCalledWith({ Exception: { Type: expect.any(String), Message: expect.not.stringContaining('credentials') } }, 500);
  });

  it('still surfaces client errors with their own message', async () => {
    const c = createContext();
    await new FailRoute(new BadRequestError('q is required')).handle(c);
    expect(c.json).toHaveBeenCalledWith({ Exception: { Type: new BadRequestError('q is required').getErrorType(), Message: 'q is required' } }, 400);
  });
});

describe('IAdminActivityAPIRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates for superadmins outside demo mode', async () => {
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
    const c = createContext();
    await new AdminOkRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith({ ok: true });
  });

  it('rejects non-superadmins', async () => {
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(false);
    const c = createContext();
    await new AdminOkRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ Exception: expect.objectContaining({ Type: new UnauthorizedError('x').getErrorType() }) }),
      401,
    );
  });

  it('rejects admin operations in demo mode', async () => {
    const c = createContext();
    (c.env as unknown as Record<string, unknown>)['DEMO_MODE'] = 'true';
    await new AdminOkRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ Exception: expect.objectContaining({ Type: expect.any(String) }) }),
      expect.any(Number),
    );
    const [body] = vi.mocked(c.json).mock.calls[0] as unknown as [{ Exception: { Type: string } }];
    expect(body.Exception.Type).toBe(new MethodNotAllowedError('x').getErrorType());
  });
});
