import { DatabaseError } from '@rexezuge/errors';
import { assertSqlIdentifier, BaseDAO as SdkBaseDAO } from '@rexezuge/d1';
import type { D1Result } from '@rexezuge/d1';
import type { D1Queryable } from '../utils';

/** AWS account DAOs add one domain-specific orphan cleanup helper to the SDK base. */
abstract class BaseDAO extends SdkBaseDAO {
  protected declare readonly database: D1Queryable;

  constructor(database: D1Queryable) {
    super(database);
  }

  protected deleteOrphanedRows(table: string, orphanCondition: string, binds: unknown[] = []): Promise<D1Result> {
    assertSqlIdentifier(table, 'table');
    return this.run(`DELETE FROM ${table} WHERE ${orphanCondition}`, binds);
  }
}

abstract class EncryptedDAO extends BaseDAO {
  /**
   * @param encryptionKeys The keys to try, in preference order. `keys[0]` is the
   *   surface's own key and the only one used to encrypt; the rest are legacy
   *   fallbacks for rows written before the per-feature key split. See
   *   `backend-services/composition/encryptionKeys`.
   */
  constructor(
    database: D1Queryable,
    protected readonly encryptionKeys: readonly string[],
  ) {
    super(database);
  }

  /**
  The key new ciphertext is written under.
  */
  protected get encryptionKey(): string {
    if (this.encryptionKeys.length === 0) {
      throw new DatabaseError('No encryption key is configured for this DAO.');
    }
    return this.encryptionKeys[0];
  }
}

export { BaseDAO, EncryptedDAO };
