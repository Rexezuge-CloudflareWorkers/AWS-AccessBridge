import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialCacheConfigDAO } from '@aws-access-bridge/backend-data/dao/CredentialCacheConfigDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('CredentialCacheConfigDAO', () => {
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

  describe('create', () => {
    it('inserts a principal ARN into cache config', async () => {
      const dao = new CredentialCacheConfigDAO(mockDb);
      await dao.create('arn:aws:iam::123456789012:role/MyRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO credential_cache_config'));
      expect(mockStmt.bind).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/MyRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialCacheConfigDAO(mockDb);
      await expect(dao.create('arn:aws:iam::123456789012:role/MyRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('delete', () => {
    it('removes principal ARN from cache config', async () => {
      const dao = new CredentialCacheConfigDAO(mockDb);
      await dao.delete('arn:aws:iam::123456789012:role/MyRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialCacheConfigDAO(mockDb);
      await expect(dao.delete('arn:aws:iam::123456789012:role/MyRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('updateLastCachedTime', () => {
    it('updates cache timestamp for a principal ARN', async () => {
      const dao = new CredentialCacheConfigDAO(mockDb);
      await dao.updateLastCachedTime('arn:aws:iam::123456789012:role/MyRole', 1700000000);
      expect(mockStmt.bind).toHaveBeenCalledWith(1700000000, 'arn:aws:iam::123456789012:role/MyRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialCacheConfigDAO(mockDb);
      await expect(dao.updateLastCachedTime('arn:aws:iam::123456789012:role/MyRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('getPrincipalArnsNeedingUpdate', () => {
    it('returns principal ARNs needing cache update', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [{ principal_arn: 'arn:aws:iam::111111111111:role/Role1' }, { principal_arn: 'arn:aws:iam::222222222222:role/Role2' }],
      } as unknown as D1Result);
      const dao = new CredentialCacheConfigDAO(mockDb);
      const result = await dao.getPrincipalArnsNeedingUpdate(10, 1700000000);
      expect(result).toEqual(['arn:aws:iam::111111111111:role/Role1', 'arn:aws:iam::222222222222:role/Role2']);
      expect(mockStmt.bind).toHaveBeenCalledWith(1700000000, 10);
    });

    it('returns empty array when nothing needs update', async () => {
      const dao = new CredentialCacheConfigDAO(mockDb);
      const result = await dao.getPrincipalArnsNeedingUpdate(10, 1700000000);
      expect(result).toEqual([]);
    });
  });
});
