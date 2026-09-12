import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('AwsAccountsDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn(),
      all: vi.fn(),
      raw: vi.fn(),
    } as unknown as D1PreparedStatement;

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('ensureAccountExists', () => {
    it('executes INSERT OR IGNORE with account ID', async () => {
      const dao = new AwsAccountsDAO(mockDb);
      await dao.ensureAccountExists('123456789012');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('123456789012');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AwsAccountsDAO(mockDb);
      await expect(dao.ensureAccountExists('123456789012')).rejects.toThrow(DatabaseError);
    });
  });

  describe('setAccountNickname', () => {
    it('updates nickname for the account', async () => {
      const dao = new AwsAccountsDAO(mockDb);
      await dao.setAccountNickname('123456789012', 'Production');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('Production', '123456789012');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AwsAccountsDAO(mockDb);
      await expect(dao.setAccountNickname('123456789012', 'Prod')).rejects.toThrow(DatabaseError);
    });
  });

  describe('removeAccountNickname', () => {
    it('sets nickname to NULL', async () => {
      const dao = new AwsAccountsDAO(mockDb);
      await dao.removeAccountNickname('123456789012');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('NULL'));
      expect(mockStmt.bind).toHaveBeenCalledWith('123456789012');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AwsAccountsDAO(mockDb);
      await expect(dao.removeAccountNickname('123456789012')).rejects.toThrow(DatabaseError);
    });
  });

  describe('deleteOrphaned', () => {
    it('deletes accounts not referenced by any assumable_roles and returns change count', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true, meta: { changes: 3 } } as unknown as D1Result);
      const dao = new AwsAccountsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(3);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM aws_accounts.*NOT IN.*assumable_roles/s));
    });

    it('returns 0 when meta is missing', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true } as unknown as D1Result);
      const dao = new AwsAccountsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(0);
    });
  });
});
