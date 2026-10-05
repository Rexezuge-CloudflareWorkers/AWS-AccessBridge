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
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('favoriteAccount', () => {
    it('inserts the anchor into the foreign-keyed column and the id separately', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.favoriteAccount('user@test.com', '123456789012', 'usr_abc');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      // `user_email` holds the frozen anchor (the FK cannot be repointed) and
      // `user_id` the stable key, so a favourite survives an address change.
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', 'usr_abc', '123456789012');
    });

    it('still inserts when no account id could be resolved', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.favoriteAccount('user@test.com', '123456789012', null);
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', null, '123456789012');
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

    it('matches the id as well as the anchor when one is known', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.unfavoriteAccount('user@test.com', '123456789012', 'usr_abc');
      expect(mockStmt.bind).toHaveBeenCalledWith('usr_abc', 'user@test.com', '123456789012');
    });

    // Without the `user_id IS NULL` guard, an address an account has moved away
    // from would still sit in its legacy column and could match — and delete —
    // rows belonging to a different account.
    it('restricts the address arm to unattributed rows when no id was resolved', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.unfavoriteAccount('user@test.com', '123456789012', null);
      expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('user_favorite_accounts.user_id IS NULL AND user_favorite_accounts.user_email = ?'),
    );
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.unfavoriteAccount('user@test.com', '123456789012')).rejects.toThrow(DatabaseError);
    });
  });

  describe('getByUserId', () => {
    it('matches the id and the unattributed-row arm', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [] } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await dao.getByUserId('usr_abc', 'user@test.com');
      const sql = vi.mocked(mockDb.prepare).mock.calls[0]?.[0];
      expect(sql).toContain('ufa.user_id = ? OR (ufa.user_id IS NULL AND ufa.user_email = ?)');
      expect(mockStmt.bind).toHaveBeenCalledWith('usr_abc', 'user@test.com');
    });
  });

  // `getFavoriteAccounts` (the address-keyed read) was removed: `getByUserId` is
  // the only reader, and an address-keyed read would not survive an address
  // change anyway. The mapping tests live on `getByUserId`, which is the shape
  // callers actually receive.
  describe('getByUserId mapping', () => {
    it('returns favorite accounts with nicknames', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { aws_account_id: '111111111111', aws_account_nickname: 'Dev' },
          { aws_account_id: '222222222222', aws_account_nickname: null },
        ],
      } as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.getByUserId('usr_abc', 'user@test.com')).resolves.toEqual([
        { awsAccountId: '111111111111', nickname: 'Dev' },
        // A null nickname maps to `undefined`, so the UI can test presence.
        { awsAccountId: '222222222222', nickname: undefined },
      ]);
    });

    it('returns an empty array when no favorites', async () => {
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.getByUserId('usr_abc', 'user@test.com')).resolves.toEqual([]);
    });

    it('returns an empty array when results is null', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue(null as unknown as D1Result);
      const dao = new UserFavoriteAccountsDAO(mockDb);
      await expect(dao.getByUserId('usr_abc', 'user@test.com')).resolves.toEqual([]);
    });
  });
});
