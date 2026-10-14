import { describe, it, expect, vi } from 'vitest';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';

/**
 * A `D1Queryable` that records the statement it was handed and answers success.
 *
 * Every other suite in this directory mocks the **DAO**, which is right for
 * testing what a caller does with a return value and useless for testing what the
 * DAO wrote. This one is the other half: the SQL and its bindings are the
 * contract, and a typo in a status string or a dropped binding is invisible to a
 * mocked DAO because the mock accepts anything.
 */
function recordingDatabase(): { database: D1Queryable; statements: Array<{ sql: string; binds: unknown[] }> } {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...binds: unknown[]) => {
      statements.push({ sql, binds });
      return { run: async () => ({ success: true, meta: { changes: 1, last_row_id: 0 }, results: [] }) };
    },
    run: async () => {
      statements.push({ sql, binds: [] });
      return { success: true, meta: { changes: 1, last_row_id: 0 }, results: [] };
    },
  }));
  return { database: { prepare } as unknown as D1Queryable, statements };
}

describe('BackgroundTaskRunDAO.skipRun', () => {
  it('writes the skipped status and keeps the reason', async () => {
    // `skipped` was a status on the model with nothing writing it, so an operator
    // asking "did the nightly job have anything to do?" read `success` — a claim
    // about work done rather than work found. `error_message` carries the reason
    // so the status is not the whole answer; it is nullable in the schema because
    // most statuses have none, not because this one does.
    const { database, statements } = recordingDatabase();
    await new BackgroundTaskRunDAO(database).skipRun('run-7', 'nothing due');

    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement.sql).toContain("status = 'skipped'");
    expect(statement.sql).toContain('completed_at = ?');
    expect(statement.binds[0]).toBe('nothing due');
    // Binding order is the whole reason to pin this: swapping the reason and the
    // timestamp writes a real timestamp into `error_message` and a `null` into a
    // `NOT NULL`-in-practice column, and only an operator reading the run table
    // would ever notice.
    expect(typeof statement.binds[1]).toBe('number');
    expect(statement.binds[2]).toBe('run-7');
  });

  it('records a skip with no reason as a null rather than the word undefined', async () => {
    const { database, statements } = recordingDatabase();
    await new BackgroundTaskRunDAO(database).skipRun('run-8');
    expect(statements[0].binds[0]).toBeNull();
  });
});
