import { describe, it, expect, vi } from 'vitest';
import { LIKEUtil } from '@aws-access-bridge/backend-data/utils/LIKEUtil';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';

describe('LIKEUtil', () => {
  it('neutralises the percent wildcard', () => {
    expect(LIKEUtil.contains('%')).toBe('%\\%%');
  });

  it('neutralises the single-character wildcard', () => {
    expect(LIKEUtil.contains('_')).toBe('%\\_%');
  });

  it('neutralises the escape character itself, so an escaped wildcard stays literal', () => {
    expect(LIKEUtil.contains('\\')).toBe('%\\\\%');
    // Without escaping the backslash, `\%` would consume the escape and leave a
    // bare `%`, silently turning the escape back into a wildcard.
    expect(LIKEUtil.escape('\\%')).toBe('\\\\\\%');
  });

  it('wraps an ordinary term unchanged', () => {
    expect(LIKEUtil.contains('web-01')).toBe('%web-01%');
  });

  it('emits the ESCAPE clause the escaped patterns require', () => {
    expect(LIKEUtil.escapeClause).toBe("ESCAPE '\\'");
  });

  it('escapes only the metacharacters', () => {
    expect(LIKEUtil.escape("it's a 50% _test_")).toBe("it's a 50\\% \\_test\\_");
  });
});

describe('search DAOs bind an escaped LIKE pattern', () => {
  /**
   * The values are always bound, so this is not injection — it is that a search
   * box containing `%` returned every row instead of searching for a literal `%`.
   */
  function capturingDb(): { db: D1Database; bindings: () => unknown[][] } {
    const seen: unknown[][] = [];
    const stmt = {
      bind: vi.fn((...values: unknown[]) => {
        seen.push(values);
        return stmt;
      }),
      run: vi.fn(),
      first: vi.fn().mockResolvedValue({ total: 0 }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    return { db: { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database, bindings: () => seen };
  }

  it('ResourceInventoryDAO escapes the search term and declares ESCAPE', async () => {
    const { db, bindings } = capturingDb();
    await new ResourceInventoryDAO(db).searchResources(['123456789012'], '100%');
    const bound = bindings().flat();
    expect(bound).toContain('%100\\%%');
    const sql = vi.mocked(db.prepare).mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sql).toContain("ESCAPE '\\'");
  });

  it('AssumableRolesDAO escapes the search term and declares ESCAPE', async () => {
    const { db, bindings } = capturingDb();
    await new AssumableRolesDAO(db).searchAccountsByQuery({ userId: 'usr_1', anchorEmail: 'user@example.com' }, 'a_b');
    const bound = bindings().flat();
    expect(bound).toContain('%a\\_b%');
    const sql = vi.mocked(db.prepare).mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sql).toContain("ESCAPE '\\'");
  });
});