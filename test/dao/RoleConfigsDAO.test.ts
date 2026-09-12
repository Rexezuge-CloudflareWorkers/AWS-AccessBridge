import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('RoleConfigsDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
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

  describe('getRoleConfig', () => {
    it('returns role config when found', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        aws_account_id: '123456789012',
        role_name: 'Admin',
        destination_path: '/s3',
        destination_region: 'us-west-2',
        role_session_duration_seconds: 14400,
      });
      const dao = new RoleConfigsDAO(mockDb);
      const result = await dao.getRoleConfig('123456789012', 'Admin');
      expect(result).toEqual({
        awsAccountId: '123456789012',
        roleName: 'Admin',
        destinationPath: '/s3',
        destinationRegion: 'us-west-2',
        roleSessionDurationSeconds: 14400,
      });
    });

    it('returns undefined when not found', async () => {
      const dao = new RoleConfigsDAO(mockDb);
      const result = await dao.getRoleConfig('123456789012', 'NonExistent');
      expect(result).toBeUndefined();
    });

    it('handles null optional fields', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        aws_account_id: '123456789012',
        role_name: 'Admin',
        destination_path: null,
        destination_region: null,
        role_session_duration_seconds: null,
      });
      const dao = new RoleConfigsDAO(mockDb);
      const result = await dao.getRoleConfig('123456789012', 'Admin');
      expect(result).toEqual({
        awsAccountId: '123456789012',
        roleName: 'Admin',
        destinationPath: null,
        destinationRegion: null,
        roleSessionDurationSeconds: null,
      });
    });
  });

  describe('setRoleConfig', () => {
    it('upserts role config with all fields', async () => {
      const dao = new RoleConfigsDAO(mockDb);
      await dao.setRoleConfig('123456789012', 'Admin', '/s3', 'us-west-2', 14400);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('123456789012', 'Admin', '/s3', 'us-west-2', 14400);
    });

    it('stores null for missing optional fields', async () => {
      const dao = new RoleConfigsDAO(mockDb);
      await dao.setRoleConfig('123456789012', 'Admin');
      expect(mockStmt.bind).toHaveBeenCalledWith('123456789012', 'Admin', null, null, null);
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new RoleConfigsDAO(mockDb);
      await expect(dao.setRoleConfig('123456789012', 'Admin')).rejects.toThrow(DatabaseError);
    });
  });

  describe('deleteRoleConfig', () => {
    it('deletes role config', async () => {
      const dao = new RoleConfigsDAO(mockDb);
      await dao.deleteRoleConfig('123456789012', 'Admin');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('123456789012', 'Admin');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new RoleConfigsDAO(mockDb);
      await expect(dao.deleteRoleConfig('123456789012', 'Admin')).rejects.toThrow(DatabaseError);
    });
  });

  describe('deleteOrphaned', () => {
    it('deletes role configs whose account has no assumable_roles and returns change count', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true, meta: { changes: 2 } } as unknown as D1Result);
      const dao = new RoleConfigsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM role_configs.*NOT IN.*assumable_roles/s));
    });

    it('returns 0 when meta is missing', async () => {
      const dao = new RoleConfigsDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(0);
    });
  });
});
