import { describe, it, expect } from 'vitest';
import { buildListRolesQuery, buildSearchRolesQuery, hiddenFilterClause } from '@aws-access-bridge/backend-data/dao/AssumableRolesQueries';
import { mapRowsToAssumableMap } from '@aws-access-bridge/backend-data/dao/AssumableRolesMapper';

describe('AssumableRolesQueries', () => {
  it('omits the hidden filter when requested', () => {
    expect(hiddenFilterClause(true)).toBe('');
    expect(hiddenFilterClause(false)).toContain('hidden');
  });

  it('builds list and search queries sharing the same FROM/JOIN shape', () => {
    const list = buildListRolesQuery(false);
    const search = buildSearchRolesQuery(false);
    expect(list).toContain('LIMIT ? OFFSET ?');
    expect(search).toContain('LIKE ?');
    expect(search).toContain('FROM assumable_roles ar');
    expect(list).toContain('FROM assumable_roles ar');
  });
});

describe('mapRowsToAssumableMap', () => {
  it('groups roles by account with favorites, nicknames, and hidden split', () => {
    const result = mapRowsToAssumableMap([
      { aws_account_id: '111111111111', role_name: 'Admin', hidden: 0, aws_account_nickname: 'Dev', is_favorite: 1 },
      { aws_account_id: '111111111111', role_name: 'Secret', hidden: 1, aws_account_nickname: 'Dev', is_favorite: 1 },
      { aws_account_id: '222222222222', role_name: 'ReadOnly', hidden: null, aws_account_nickname: null, is_favorite: 0 },
    ]);
    expect(result['111111111111']).toEqual({ roles: ['Admin'], hiddenRoles: ['Secret'], nickname: 'Dev', favorite: true });
    expect(result['222222222222']).toEqual({ roles: ['ReadOnly'], hiddenRoles: [], nickname: undefined, favorite: false });
  });

  it('returns an empty map for no rows', () => {
    expect(mapRowsToAssumableMap([])).toEqual({});
  });
});
