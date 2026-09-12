import type { D1Queryable } from '../utils';
import { executeD1WithRetry } from '../utils/D1Utils';

const SQL_IDENTIFIER_PATTERN = /^[a-z_]\w*$/i;

function assertSqlIdentifier(value: string, label: string): void {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${value}`);
  }
}

abstract class BaseDAO {
  constructor(protected readonly database: D1Queryable) {}

  protected withRetry(operation: () => Promise<D1Result>, context: string): Promise<D1Result> {
    return executeD1WithRetry(operation, context);
  }

  // Generic row lookup by primary key. Table/column identifiers are allow-listed
  // to keep dynamic SQL safe; values always go through bindings.
  protected static async findById<T>(db: D1Queryable, table: string, idColumn: string, idValue: string, columns = '*'): Promise<T | null> {
    assertSqlIdentifier(table, 'table');
    assertSqlIdentifier(idColumn, 'idColumn');
    let selectColumns = '*';
    if (columns !== '*') {
      const validated: string[] = columns.split(',').map((column: string): string => {
        const trimmed: string = column.trim();
        assertSqlIdentifier(trimmed, 'column');
        return trimmed;
      });
      selectColumns = validated.join(', ');
    }
    const row: T | null = await db.prepare(`SELECT ${selectColumns} FROM ${table} WHERE ${idColumn} = ? LIMIT 1`).bind(idValue).first<T>();
    return row ?? null;
  }

  // Generic batched delete of rows older than a cutoff. Mirrors the per-DAO
  // DELETE ... WHERE id IN (SELECT ... LIMIT ?) pattern with retry.
  protected static async deleteOlderThan(
    db: D1Queryable,
    table: string,
    timeColumn: string,
    cutoff: number | string,
    limit: number,
    idColumn: string,
  ): Promise<number> {
    assertSqlIdentifier(table, 'table');
    assertSqlIdentifier(timeColumn, 'timeColumn');
    assertSqlIdentifier(idColumn, 'idColumn');
    const result: D1Result = await executeD1WithRetry(
      (): Promise<D1Result> =>
        db
          .prepare(
            `DELETE FROM ${table}
             WHERE ${idColumn} IN (
               SELECT ${idColumn} FROM ${table}
               WHERE ${timeColumn} < ?
               LIMIT ?
             )`,
          )
          .bind(cutoff, limit)
          .run(),
      `delete old rows from ${table}`,
    );
    return (result.meta as { changes?: number })?.changes ?? 0;
  }
}

abstract class EncryptedDAO extends BaseDAO {
  constructor(
    database: D1Queryable,
    protected readonly masterKey: string,
  ) {
    super(database);
  }
}

export { BaseDAO, EncryptedDAO };
