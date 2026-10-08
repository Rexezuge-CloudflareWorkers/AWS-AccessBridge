import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('UserAccessTokenDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
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

  describe('create', () => {
    it('inserts a new access token', async () => {
      const dao = new UserAccessTokenDAO(mockDb);
      await dao.create('token-id', 'user@test.com', 'token-value', 'My Token', 1_800_000_000, 'usr_abc');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_access_tokens'));
      // The anchor goes in the FK'd column; the id is what survives a change.
      expect(mockStmt.bind).toHaveBeenCalledWith(
        'token-id',
        'user@test.com',
        'token-value',
        'My Token',
        expect.any(Number),
        1_800_000_000,
        'usr_abc',
      );
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserAccessTokenDAO(mockDb);
      await expect(dao.create('id', 'user@test.com', 'token', 'name', 0)).rejects.toThrow(DatabaseError);
    });
  });

  describe('getById', () => {
    it('returns token metadata when found', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        token_id: 'tid',
        user_email: 'user@test.com',
        token_hash: 'tok-hash',
        name: 'My Token',
        created_at: 1_700_000_000,
        expires_at: 1_800_000_000,
        user_id: 'usr_abc',
        last_used_at: 1_750_000_000,
      });
      const dao = new UserAccessTokenDAO(mockDb);
      const result = await dao.getById('tid', false);
      expect(result).toEqual({
        tokenId: 'tid',
        userEmail: 'user@test.com',
        userId: 'usr_abc',
        name: 'My Token',
        createdAt: 1_700_000_000,
        expiresAt: 1_800_000_000,
        lastUsedAt: 1_750_000_000,
      });
    });

    it('returns undefined when not found', async () => {
      const dao = new UserAccessTokenDAO(mockDb);
      const result = await dao.getById('nonexistent', false);
      expect(result).toBeUndefined();
    });
  });

  describe('getByTokenHash', () => {
    it('returns token metadata when found', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        token_id: 'tid',
        user_email: 'user@test.com',
        token_hash: 'tok-hash',
        name: 'My Token',
        created_at: 1_700_000_000,
        expires_at: 1_800_000_000,
        user_id: null,
        last_used_at: undefined,
      });
      const dao = new UserAccessTokenDAO(mockDb);
      const result = await dao.getByTokenHash('tok', false);
      // A token with no id (pre-0032) reports null, which is what makes
      // TokenService fall back to the stored address.
      expect(result).toEqual({
        tokenId: 'tid',
        userEmail: 'user@test.com',
        userId: null,
        name: 'My Token',
        createdAt: 1_700_000_000,
        expiresAt: 1_800_000_000,
        lastUsedAt: undefined,
      });
    });
  });

  describe('getByUserEmail', () => {
    it('returns all tokens for a user', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { token_id: 't1', user_email: 'user@test.com', name: 'Token 1', created_at: 100, expires_at: 200, last_used_at: 150 },
          { token_id: 't2', user_email: 'user@test.com', name: 'Token 2', created_at: 101, expires_at: 201, last_used_at: undefined },
        ],
      } as unknown as D1Result);
      const dao = new UserAccessTokenDAO(mockDb);
      const result = await dao.getByUserEmail('user@test.com');
      expect(result).toHaveLength(2);
      expect(result[0].tokenId).toBe('t1');
      expect(result[1].tokenId).toBe('t2');
    });
  });

  describe('updateLastUsedByTokenHash', () => {
    it('updates the last_used_at timestamp by token value', async () => {
      const dao = new UserAccessTokenDAO(mockDb);
      await dao.updateLastUsedByTokenHash('my-token');
      expect(mockStmt.bind).toHaveBeenCalledWith(expect.any(Number), 'my-token');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserAccessTokenDAO(mockDb);
      await expect(dao.updateLastUsedByTokenHash('my-token')).rejects.toThrow(DatabaseError);
    });
  });

  describe('delete', () => {
    it('deletes a token by ID and user email', async () => {
      const dao = new UserAccessTokenDAO(mockDb);
      await dao.delete('tid', 'user@test.com');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('tid', 'user@test.com');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new UserAccessTokenDAO(mockDb);
      await expect(dao.delete('tid', 'user@test.com')).rejects.toThrow(DatabaseError);
    });
  });
});
