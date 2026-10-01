import { describe, it, expect, vi } from 'vitest';
import { ownerClause } from '@aws-access-bridge/backend-data/dao/AssumableRolesQueries';
import { UserFavoriteAccountsDAO } from '@aws-access-bridge/backend-data/dao/UserFavoriteAccountsDAO';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import { TeamMembersDAO } from '@aws-access-bridge/backend-data/dao/TeamMembersDAO';

/**
 * The 0032 owner predicate is security-critical and had four independent
 * definitions, each carrying its own explanation of why the `user_id IS NULL`
 * guard matters. A fix applied to one copy would silently miss the others, so
 * they now share one definition — these tests pin the emitted SQL, because a
 * shared helper can still be misapplied by a caller (an empty table alias, say).
 */

/** Captures the SQL and bindings of every prepared statement. */
function capturingDb(): { db: D1Database; sql: () => string[]; bindings: () => unknown[][] } {
  const seenSql: string[] = [];
  const seenBindings: unknown[][] = [];
  const stmt = {
    bind: vi.fn((...values: unknown[]) => {
      seenBindings.push(values);
      return stmt;
    }),
    run: vi.fn().mockResolvedValue({ success: true } as D1Result),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  return {
    db: { prepare: vi.fn((sql: string) => (seenSql.push(sql), stmt)) } as unknown as D1Database,
    sql: () => seenSql,
    bindings: () => seenBindings,
  };
}

describe('ownerClause', () => {
  it('emits the two-arm predicate with the alias applied to both arms', () => {
    expect(ownerClause('ar')).toBe('(ar.user_id = ? OR (ar.user_id IS NULL AND ar.user_email = ?))');
  });

  it('keeps the IS NULL guard on the address arm', () => {
    // Without it, an address one account has moved away from would also match a
    // different account's row.
    expect(ownerClause('x')).toContain('x.user_id IS NULL');
  });
});

describe('user-keyed DAOs emit valid, aliased SQL', () => {
  it('UserFavoriteAccountsDAO.unfavoriteAccount qualifies both arms', async () => {
    const { db, sql, bindings } = capturingDb();
    await new UserFavoriteAccountsDAO(db).unfavoriteAccount('user@example.com', '123456789012', 'usr_1');
    const statement = sql().join('\n');
    expect(statement).toContain('user_favorite_accounts.user_id');
    // A leading dot from an empty alias would be a SQL syntax error.
    expect(statement).not.toMatch(/\s\.\s*user_id/);
    expect(statement).not.toMatch(/\(\s*\./);
    expect(bindings()).toContainEqual(['usr_1', 'user@example.com', '123456789012']);
  });

  it('UserFavoriteAccountsDAO.unfavoriteAccount narrows to the address arm for a null id', async () => {
    const { db, sql, bindings } = capturingDb();
    await new UserFavoriteAccountsDAO(db).unfavoriteAccount('user@example.com', '123456789012', null);
    const statement = sql().join('\n');
    expect(statement).toContain('user_favorite_accounts.user_id IS NULL');
    expect(statement).not.toContain('usr_');
    expect(bindings()).toContainEqual(['user@example.com', '123456789012']);
  });

  it('UserAccessTokenDAO.delete qualifies both arms', async () => {
    const { db, sql, bindings } = capturingDb();
    await new UserAccessTokenDAO(db).delete('tok_1', 'user@example.com', 'usr_1');
    const statement = sql().join('\n');
    expect(statement).toContain('user_access_tokens.user_id');
    expect(statement).not.toMatch(/\(\s*\./);
    expect(bindings()).toContainEqual(['tok_1', 'usr_1', 'user@example.com']);
  });

  it('UserAccessTokenDAO.delete narrows to the address arm for a null id', async () => {
    const { db, sql, bindings } = capturingDb();
    await new UserAccessTokenDAO(db).delete('tok_1', 'user@example.com', null);
    expect(sql().join('\n')).toContain('user_access_tokens.user_id IS NULL');
    expect(bindings()).toContainEqual(['tok_1', 'user@example.com']);
  });

  it('TeamMembersDAO emits the shared predicate for every statement', async () => {
    const owner = { userId: 'usr_1', anchorEmail: 'user@example.com' };
    // `listMembers` joins with the `tm` alias; the rest address the table directly.
    for (const [call, expectedAlias] of [
      [(dao: TeamMembersDAO) => dao.removeMember('t1', owner), 'team_members'],
      [(dao: TeamMembersDAO) => dao.updateMemberRole('t1', owner, 'admin'), 'team_members'],
      [(dao: TeamMembersDAO) => dao.getMembersByTeam('t1'), 'tm'],
      [(dao: TeamMembersDAO) => dao.isTeamAdmin('t1', owner), 'team_members'],
    ] as const) {
      const { db, sql } = capturingDb();
      await call(new TeamMembersDAO(db));
      const statement = sql().join('\n');
      expect(statement).toContain(`${expectedAlias}.user_id`);
      expect(statement).toContain(`${expectedAlias}.user_email`);
      // A leading dot from an empty alias would be a SQL syntax error.
      expect(statement).not.toMatch(/\(\s*\./);
    }
  });

  it('binds the id before the anchor for the two-arm predicate', async () => {
    // Order matters: the shared clause is `id = ?` then `user_email = ?`.
    const { db, bindings } = capturingDb();
    await new TeamMembersDAO(db).removeMember('t1', { userId: 'usr_1', anchorEmail: 'user@example.com' });
    expect(bindings()).toContainEqual(['t1', 'usr_1', 'user@example.com']);
  });
});