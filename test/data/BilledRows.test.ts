import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BILLED_INDEX_ENTRIES, billedRowsForTable } from '@aws-access-bridge/backend-data/constants/d1/billedRows';

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(path.join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

/**
 * Every index in the schema, keyed by the table it is on.
 */
function indexCountByTable(sql: string): Map<string, number> {
  const counts = new Map<string, number>();
  const pattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(\w+)/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = match[1];
    counts.set(table, (counts.get(table) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every table the schema creates.
 */
function declaredTables(sql: string): Set<string> {
  const tables = new Set<string>();
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    tables.add(match[1]);
  }
  return tables;
}

describe('billedRowsForTable', () => {
  it('multiplies by the row plus every index the table carries', () => {
    // `assumable_roles` has three indexes, so a write is billed at four rows —
    // which is the whole reason the accounting shape carries a figure beside
    // `changes`: a caller reading only `changes` believes it has roughly an
    // order of magnitude more headroom than it does.
    expect(billedRowsForTable('assumable_roles', 1)).toBe(4);
    expect(billedRowsForTable('assumable_roles', 10)).toBe(40);
  });

  it('answers absent, not zero, for a table it does not know', () => {
    // `null` is the SDK's own convention here, and the reason is load-bearing:
    // a confident `0` reads as "this write was free", which is a claim about a
    // table this function has never seen.
    expect(billedRowsForTable('table_that_does_not_exist', 1)).toBeNull();
  });

  it('never under-counts against the schema it was derived from', () => {
    // The figure is a ceiling, so it must be at least `1 + index count` for every
    // indexed table, and the table must exist. A migration that adds an index
    // without updating this file does not fail this test — it makes the ceiling
    // wrong in the safe direction — so the next assertion is the one that bites.
    const counts = indexCountByTable(migrationSql());
    for (const [table, multiplier] of Object.entries(BILLED_INDEX_ENTRIES)) {
      expect(multiplier, `${table} has no index in the schema but is priced at ${multiplier}`).toBeGreaterThanOrEqual(
        1 + (counts.get(table) ?? 0),
      );
    }
  });

  it('prices every indexed table the schema declares', () => {
    // This is the assertion that catches the stale table. A new migration that
    // indexes a table nobody priced leaves it absent here, so its writes report
    // `billedRows: null` and the accounting silently stops covering it.
    const counts = indexCountByTable(migrationSql());
    const unpriced = [...counts.keys()].filter((table) => BILLED_INDEX_ENTRIES[table] === undefined);
    expect(unpriced, 'indexed tables with no billed-rows figure').toEqual([]);
  });

  it('prices nothing for a table the schema does not declare', () => {
    const tables = declaredTables(migrationSql());
    const phantom = Object.keys(BILLED_INDEX_ENTRIES).filter((table) => !tables.has(table));
    expect(phantom, 'priced tables that no migration creates').toEqual([]);
  });
});
