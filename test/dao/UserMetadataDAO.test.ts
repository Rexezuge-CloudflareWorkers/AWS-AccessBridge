import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('UserMetadataDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
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

  describe('ensureUserEmailExists', () => {
    it('executes INSERT OR IGNORE with user email', async () => {
      const dao = new UserMetadataDAO(mockDb);
      await dao.ensureUserEmailExists('user@example.com');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('user@example.com');
      expect(mockStmt.run).toHaveBeenCalled();
    });

    it('throws DatabaseError when query fails', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'db error' } as unknown as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.ensureUserEmailExists('user@test.com')).rejects.toThrow(DatabaseError);
    });
  });

  describe('isSuperAdmin', () => {
    it('returns true when user is super admin', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ is_superadmin: true });
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.isSuperAdmin('admin@example.com');
      expect(result).toBe(true);
    });

    it('returns false when user is not super admin', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ is_superadmin: false });
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.isSuperAdmin('user@example.com');
      expect(result).toBe(false);
    });

    it('returns false when user not found', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue(null);
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.isSuperAdmin('unknown@example.com');
      expect(result).toBe(false);
    });

    it('returns false when is_superadmin is undefined', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({});
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.isSuperAdmin('user@example.com');
      expect(result).toBe(false);
    });
  });

  describe('getOrCreateFederationUsername', () => {
    it('returns existing federation username', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ federation_username: 'EXISTING123' });
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.getOrCreateFederationUsername('user@example.com');
      expect(result).toBe('EXISTING123');
    });

    it('generates and stores a new federation username when none exists', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ federation_username: null });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true } as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      const result = await dao.getOrCreateFederationUsername('user@example.com');
      // Should be uppercase hex without dashes (32 chars)
      expect(result).toMatch(/^[0-9A-F]{32}$/);
      expect(mockStmt.bind).toHaveBeenCalledWith(result, 'user@example.com');
    });

    it('throws DatabaseError when update fails', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ federation_username: null });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'update failed' } as unknown as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.getOrCreateFederationUsername('user@example.com')).rejects.toThrow(DatabaseError);
    });
  });

  describe('preferredLanguage', () => {
    it('returns the stored language', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ preferred_language: 'de' });
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.getPreferredLanguage('user@example.com')).resolves.toBe('de');
    });

    it('returns null when unset', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue(null);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.getPreferredLanguage('user@example.com')).resolves.toBeNull();
    });

    it('updates the stored language', async () => {
      const dao = new UserMetadataDAO(mockDb);
      await dao.updatePreferredLanguage('user@example.com', 'ja');
      expect(mockStmt.bind).toHaveBeenCalledWith('ja', 'user@example.com');
    });

    it('throws DatabaseError when update fails', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'update failed' } as unknown as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.updatePreferredLanguage('user@example.com', 'ja')).rejects.toThrow(DatabaseError);
    });
  });
});
