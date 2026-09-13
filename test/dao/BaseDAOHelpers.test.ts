import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseDAO } from '@aws-access-bridge/backend-data/dao/BaseDAO';

class TestDAO extends BaseDAO {
  public find(table: string, id: string) {
    return this.findRowById<{ id: string }>(table, 'id', id);
  }

  public prune(table: string) {
    return this.deleteRowsOlderThan(table, 'created_at', 100, 10, 'id');
  }
}

function mockDb(all?: unknown, first?: unknown) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 3 } }),
    first: vi.fn().mockResolvedValue(first ?? null),
    all: vi.fn().mockResolvedValue(all ?? { results: [] }),
  };
  return { db: { prepare: vi.fn().mockReturnValue(stmt) }, stmt } as unknown as {
    db: D1Database;
    stmt: { bind: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn>; first: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> };
  };
}

describe('BaseDAO helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findById allow-lists identifiers and returns rows', async () => {
    const { db } = mockDb();
    const row = await BaseDAO.findById<{ id: string }>(db as never, 'teams', 'id', 't1', 'id, name');
    expect(row).toBeNull();
    expect(() => BaseDAO.findById(db as never, 'teams; DROP TABLE teams', 'id', 't1')).rejects.toThrow('Invalid SQL identifier');
  });

  it('findRowById instance helper delegates to the static', async () => {
    const { db } = mockDb(undefined, { id: 't1' });
    await expect(new TestDAO(db as never).find('teams', 't1')).resolves.toEqual({ id: 't1' });
  });

  it('deleteOlderThan batches with retry and returns change counts', async () => {
    const { db } = mockDb();
    await expect(BaseDAO.deleteOlderThan(db as never, 'audit_logs', 'created_at', 100, 10, 'id')).resolves.toBe(3);
    await expect(new TestDAO(db as never).prune('audit_logs')).resolves.toBe(3);
  });

  it('deleteOrphanedRows issues deletes with bindings', async () => {
    const { db, stmt } = mockDb();
    const dao = new TestDAO(db as never) as unknown as { deleteOrphanedRows(t: string, c: string, b: unknown[]): Promise<unknown> };
    await dao.deleteOrphanedRows('team_accounts', 'team_id NOT IN (SELECT id FROM teams)', []);
    expect(stmt.bind).toHaveBeenCalled();
  });
});
