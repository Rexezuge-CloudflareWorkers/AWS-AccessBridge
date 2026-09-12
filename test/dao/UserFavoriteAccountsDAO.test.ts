import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFavoriteAccountsDAO } from '@aws-access-bridge/backend-data/dao/UserFavoriteAccountsDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('UserFavoriteAccountsDAO', () => {
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

  describe('favoriteAccount', () => {
    it('inserts a favorite record', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.favoriteAccount('user@test.com', '123456789012');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', '123456789012');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.favoriteAccount('user@test.com', '123456789012')).rejects.toThrow(DatabaseError);
    });
  });

  describe('unfavoriteAccount', () => {
    it('deletes the favorite record', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.unfavoriteAccount('user@test.com', '123456789012');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', '123456789012');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.unfavoriteAccount('user@test.com', '123456789012')).rejects.toThrow(DatabaseError);
    });
  });

  describe('getFavoriteAccounts', () => {
    it('returns favorite accounts with nicknames', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { aws_account_id: '111111111111', aws_account_nickname: 'Dev' },
          { aws_account_id: '222222222222', aws_account_nickname: null },
        ],
      } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      const result = await dao.getFavoriteAccounts('user@test.com');
      expect(result).toEqual([
        { awsAccountId: '111111111111', nickname: 'Dev' },
        { awsAccountId: '222222222222', nickname: undefined },
      ]);
    });

    it('returns empty array when no favorites', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      const result = await dao.getFavoriteAccounts('user@test.com');
      expect(result).toEqual([]);
    });

    it('returns empty array when results is null', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue(null as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      const result = await dao.getFavoriteAccounts('user@test.com');
      expect(result).toEqual([]);
    });
  });
});
