import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { DatabaseError, UnauthorizedError } from '@aws-access-bridge/backend-errors';

describe('AssumableRolesDAO', () => {
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

  describe('getRolesByUserAndAccount', () => {
    it('returns role names for a user/account pair', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [{ role_name: 'AdminRole' }, { role_name: 'ReadOnlyRole' }],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const roles = await dao.getRolesByUserAndAccount('user@test.com', '123456789012');
      expect(roles).toEqual(['AdminRole', 'ReadOnlyRole']);
    });

    it('returns empty array when no roles found', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [] } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const roles = await dao.getRolesByUserAndAccount('user@test.com', '123456789012');
      expect(roles).toEqual([]);
    });

    it('returns empty array when results is null', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue(null as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const roles = await dao.getRolesByUserAndAccount('user@test.com', '123456789012');
      expect(roles).toEqual([]);
    });
  });

  describe('getTotalAccountsCount', () => {
    it('returns total count of accessible accounts', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [{ total_accounts: 5 }],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const count = await dao.getTotalAccountsCount('user@test.com', false);
      expect(count).toBe(5);
    });

    it('returns 0 when no accounts found', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [] } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const count = await dao.getTotalAccountsCount('user@test.com', false);
      expect(count).toBe(0);
    });
  });

  describe('getAllRolesByUserEmail', () => {
    it('returns grouped roles by account', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { aws_account_id: '111111111111', role_name: 'Admin', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 1 },
          { aws_account_id: '111111111111', role_name: 'ReadOnly', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 1 },
          { aws_account_id: '222222222222', role_name: 'Admin', hidden: 0, aws_account_nickname: null, is_favorite: 0 },
        ],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.getAllRolesByUserEmail('user@test.com');
      expect(result['111111111111']).toEqual({
        roles: ['Admin', 'ReadOnly'],
        hiddenRoles: [],
        nickname: 'Dev',
        favorite: true,
      });
      expect(result['222222222222']).toEqual({
        roles: ['Admin'],
        hiddenRoles: [],
        nickname: undefined,
        favorite: false,
      });
    });

    it('splits rows into roles and hiddenRoles based on hidden flag when showHidden=true', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { aws_account_id: '111111111111', role_name: 'Visible', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 0 },
          { aws_account_id: '111111111111', role_name: 'Hidden', hidden: 1, aws_account_nickname: 'Dev', is_favorite: 0 },
        ],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.getAllRolesByUserEmail('user@test.com', true);
      expect(result['111111111111']).toEqual({
        roles: ['Visible'],
        hiddenRoles: ['Hidden'],
        nickname: 'Dev',
        favorite: false,
      });
    });

    it('returns empty object when no roles found', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [] } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.getAllRolesByUserEmail('user@test.com');
      expect(result).toEqual({});
    });
  });

  describe('verifyUserHasAccessToRole', () => {
    it('resolves when user has access', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue(1);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.verifyUserHasAccessToRole('user@test.com', '123456789012', 'AdminRole')).resolves.toBeUndefined();
    });

    it('throws UnauthorizedError when user does not have access', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue(null);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.verifyUserHasAccessToRole('user@test.com', '123456789012', 'AdminRole')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('grantUserAccessToRole', () => {
    it('executes INSERT OR IGNORE', async () => {
      const dao = new AssumableRolesDAO(mockDb);
      await dao.grantUserAccessToRole('user@test.com', '123456789012', 'AdminRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', '123456789012', 'AdminRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.grantUserAccessToRole('user@test.com', '123456789012', 'AdminRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('revokeUserAccessToRole', () => {
    it('executes DELETE', async () => {
      const dao = new AssumableRolesDAO(mockDb);
      await dao.revokeUserAccessToRole('user@test.com', '123456789012', 'AdminRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('user@test.com', '123456789012', 'AdminRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.revokeUserAccessToRole('user@test.com', '123456789012', 'AdminRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('hideRole / unhideRole', () => {
    it('hideRole sets hidden = TRUE', async () => {
      const dao = new AssumableRolesDAO(mockDb);
      await dao.hideRole('user@test.com', '123456789012', 'AdminRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('hidden = TRUE'));
    });

    it('unhideRole sets hidden = FALSE', async () => {
      const dao = new AssumableRolesDAO(mockDb);
      await dao.unhideRole('user@test.com', '123456789012', 'AdminRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('hidden = FALSE'));
    });

    it('hideRole throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.hideRole('user@test.com', '123456789012', 'AdminRole')).rejects.toThrow(DatabaseError);
    });

    it('unhideRole throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      await expect(dao.unhideRole('user@test.com', '123456789012', 'AdminRole')).rejects.toThrow(DatabaseError);
    });
  });

  describe('searchAccountsByQuery', () => {
    it('returns matching accounts', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [{ aws_account_id: '111111111111', role_name: 'Admin', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 0 }],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.searchAccountsByQuery('user@test.com', 'Dev');
      expect(result['111111111111']).toEqual({
        roles: ['Admin'],
        hiddenRoles: [],
        nickname: 'Dev',
        favorite: false,
      });
    });

    it('splits rows into roles and hiddenRoles based on hidden flag when showHidden=true', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({
        results: [
          { aws_account_id: '111111111111', role_name: 'Visible', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 0 },
          { aws_account_id: '111111111111', role_name: 'Hidden', hidden: 1, aws_account_nickname: 'Dev', is_favorite: 0 },
        ],
      } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.searchAccountsByQuery('user@test.com', 'Dev', true);
      expect(result['111111111111']).toEqual({
        roles: ['Visible'],
        hiddenRoles: ['Hidden'],
        nickname: 'Dev',
        favorite: false,
      });
    });

    it('returns empty object when no matches', async () => {
      vi.mocked(mockStmt.all).mockResolvedValue({ results: [] } as unknown as D1Result);
      const dao = new AssumableRolesDAO(mockDb);
      const result = await dao.searchAccountsByQuery('user@test.com', 'nonexistent');
      expect(result).toEqual({});
    });
  });
});
