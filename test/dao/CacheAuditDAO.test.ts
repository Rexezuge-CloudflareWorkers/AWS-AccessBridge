import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';

function createMockDb() {
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    raw: vi.fn(),
  };
  const mockDb = {
    prepare: vi.fn().mockReturnValue(mockStmt),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  };
  return { mockDb, mockStmt };
}

function createMockKv(stored: Record<string, string> = {}) {
  const data = new Map(Object.entries(stored));
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = data.get(key) ?? null;
      if (value !== null && type === 'json') return JSON.parse(value);
      return value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  } as unknown as KVNamespace;
}

describe('CredentialsCacheDAO', () => {
  it('round-trips cached credentials through encryption', async () => {
    const kv = createMockKv();
    const dao = new CredentialsCacheDAO(kv, '0123456789abcdef0123456789abcdef');
    await dao.storeCachedCredential({
      principalArn: 'arn:aws:iam::123456789012:role/Dev',
      accessKeyId: 'ASIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const cached = await dao.getCachedCredential('arn:aws:iam::123456789012:role/Dev');
    expect(cached?.accessKeyId).toBe('ASIA');
    expect(cached?.secretAccessKey).toBe('shh');
    expect(cached?.sessionToken).toBe('tok');
  });

  it('returns undefined for missing entries', async () => {
    const dao = new CredentialsCacheDAO(createMockKv(), '0123456789abcdef0123456789abcdef');
    await expect(dao.getCachedCredential('arn:missing')).resolves.toBeUndefined();
  });

  it('evicts expired entries', async () => {
    const kv = createMockKv();
    const dao = new CredentialsCacheDAO(kv, '0123456789abcdef0123456789abcdef');
    await dao.storeCachedCredential({
      principalArn: 'arn:expired',
      accessKeyId: 'A',
      secretAccessKey: 'B',
      sessionToken: 'C',
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(dao.getCachedCredential('arn:expired')).resolves.toBeUndefined();
    expect(kv.delete).toHaveBeenCalled();
  });
});

describe('AuditLogDAO', () => {
  let mockDb: any;
  let mockStmt: any;

  beforeEach(() => {
    ({ mockDb, mockStmt } = createMockDb());
  });

  it('creates audit log entries', async () => {
    const dao = new AuditLogDAO(mockDb);
    await dao.create('user@example.com', 'ASSUME_ROLE', 'POST', '/user/aws/assume-role', 200);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'));
  });

  it('queries with filters and maps rows', async () => {
    vi.mocked(mockStmt.all).mockResolvedValue({
      results: [
        {
          log_id: 'l1',
          timestamp: 100,
          user_email: 'u@e.c',
          action: 'ASSUME_ROLE',
          resource: null,
          method: 'POST',
          path: '/user/aws/assume-role',
          status_code: 200,
          detail: null,
          ip_address: '1.2.3.4',
          user_agent: 'ua',
        },
      ],
    });
    vi.mocked(mockStmt.first).mockResolvedValue({ total: 1 });
    const dao = new AuditLogDAO(mockDb);
    const { logs, total } = await dao.query({ userEmail: 'u@e.c', action: 'ASSUME_ROLE' }, 50, 0);
    expect(total).toBe(1);
    expect(logs[0]).toMatchObject({ logId: 'l1', userEmail: 'u@e.c', statusCode: 200 });
  });

  it('deletes batches with a limit and returns the count', async () => {
    const dao = new AuditLogDAO(mockDb);
    await expect(dao.deleteOlderThanBatch(100, 500)).resolves.toBe(1);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT ?'));
  });
});
