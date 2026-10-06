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
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('ensureUserEmailExists', () => {
    it('executes INSERT OR IGNORE with the anchor, an id, and the normalized login address', async () => {
      const dao = new UserMetadataDAO(mockDb);
      await dao.ensureUserEmailExists('User@Example.com');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      // The identity columns are stamped at provisioning time, not left to a
      // backfill: a row created after 0032 is never backfilled again, so an
      // account provisioned without an id would be permanently unresolvable and
      // its grants/tokens would carry a NULL user_id that fails the new FKs.
      expect(mockStmt.bind).toHaveBeenCalledWith('User@Example.com', expect.stringMatching(/^usr_[0-9a-f]{32}$/), 'user@example.com');
      expect(mockStmt.run).toHaveBeenCalled();
    });

    // A database that has not applied 0032 has no identity columns, and the
    // address alone is still a complete identity there.
    it('falls back to the pre-0032 insert shape when the identity columns are absent', async () => {
      vi.mocked(mockStmt.run)
        .mockRejectedValueOnce(new Error('D1_ERROR: SQLITE_ERROR: no such column: id'))
        .mockResolvedValueOnce({ success: true } as unknown as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await dao.ensureUserEmailExists('user@example.com');
      expect(mockStmt.bind).toHaveBeenNthCalledWith(1, 'user@example.com', expect.any(String), 'user@example.com');
      expect(mockStmt.bind).toHaveBeenNthCalledWith(2, 'user@example.com');
    });

    it('rethrows a non-schema database error rather than degrading', async () => {
      vi.mocked(mockStmt.run).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: user_metadata.user_email'));
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.ensureUserEmailExists('user@example.com')).rejects.toThrow(/UNIQUE constraint failed/);
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

    it('generates and persists a federation username when the row has none', async () => {
      // First read: no username yet. Then the INSERT, then the re-read that the
      // method actually returns from.
      vi.mocked(mockStmt.first).mockResolvedValueOnce({ federation_username: null }).mockResolvedValueOnce({ federation_username: 'STORED' });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true } as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.getOrCreateFederationUsername('user@example.com')).resolves.toBe('STORED');
      // The row is provisioned first: without it the UPDATE below would match
      // nothing, so the generated name would be returned but never stored and the
      // STS RoleSessionName would change on every assume-role.
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO user_metadata (user_email, id, current_email)'));
      // `COALESCE` so a concurrent writer's value is never overwritten.
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SET federation_username = COALESCE(federation_username, ?)'));
      const updateBind = vi.mocked(mockStmt.bind).mock.calls.find((call) => (call)[1] === 'user@example.com' && /^[0-9A-F]{32}$/.test(String((call)[0]))) as unknown as [string, string];
      // The generated candidate is uppercase hex without dashes (32 chars).
      expect(updateBind[0]).toMatch(/^[0-9A-F]{32}$/);
    });

    it('provisions the identity columns before writing the federation username', async () => {
      // Regression: the INSERT used to create the row itself, without `id` or
      // `current_email`. A row created after 0032 is never backfilled again, so
      // that left a permanently unresolvable account — and D1 does not enforce
      // foreign keys by default, so an `assumable_roles` row can exist with no
      // metadata row and this path becomes the first writer.
      vi.mocked(mockStmt.first).mockResolvedValueOnce({ federation_username: null }).mockResolvedValueOnce({ federation_username: 'STORED' });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true } as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await dao.getOrCreateFederationUsername('new@example.com');

      const order = vi.mocked(mockDb.prepare).mock.calls.map(([sql]) => sql);
      const provisionIndex = order.findIndex((sql) => sql.includes('id, current_email'));
      const updateIndex = order.findIndex((sql) => sql.includes('COALESCE(federation_username'));
      expect(provisionIndex).toBeGreaterThanOrEqual(0);
      expect(updateIndex).toBeGreaterThan(provisionIndex);
    });

    it('returns the stored username on a concurrent insert instead of the losing candidate', async () => {
      vi.mocked(mockStmt.first).mockResolvedValueOnce({ federation_username: null }).mockResolvedValueOnce({ federation_username: 'WINNER' });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true } as D1Result);
      const dao = new UserMetadataDAO(mockDb);
      await expect(dao.getOrCreateFederationUsername('user@example.com')).resolves.toBe('WINNER');
    });

    it('throws DatabaseError when the insert fails', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({ federation_username: null });
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'insert failed' } as unknown as D1Result);
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
