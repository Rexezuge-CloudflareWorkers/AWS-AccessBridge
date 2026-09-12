import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';

describe('TeamAccountsDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn(),
    } as unknown as D1PreparedStatement;

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('deleteOrphaned', () => {
    it('deletes team_accounts whose account has no assumable_roles and returns change count', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true, meta: { changes: 5 } } as unknown as D1Result);
      const dao = new TeamAccountsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(5);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM team_accounts.*NOT IN.*assumable_roles/s));
    });

    it('returns 0 when meta is missing', async () => {
      const dao = new TeamAccountsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(0);
    });
  });
});
