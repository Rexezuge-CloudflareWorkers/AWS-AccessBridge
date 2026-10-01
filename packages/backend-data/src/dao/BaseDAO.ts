import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { D1Queryable } from '../utils';
import { executeD1WithRetry } from '../utils/D1Utils';

abstract class BaseDAO {
  constructor(protected readonly database: D1Queryable) {}

  protected withRetry(operation: () => Promise<D1Result>, context: string): Promise<D1Result> {
    return executeD1WithRetry(operation, context);
  }

  // Generic orphan-row delete for the 7× `deleteOrphaned(): Promise<number>`
  // implementations (AwsAccounts/RoleConfigs/CostData/DataCollectionConfig/
  // TeamAccounts/ResourceInventory/SpendAlertDAO shared shape). All seven now
  // route through here, which is what gives them the `withRetry` and the
  // `DatabaseError` on `!result.success` that each previously omitted.
  protected deleteOrphanedRows(
    table: string,
    orphanCondition: string,
    binds: unknown[] = [],
  ): Promise<D1Result> {
    return this.withRetry(
      () => this.database.prepare(`DELETE FROM ${table} WHERE ${orphanCondition}`).bind(...binds).run(),
      `delete orphaned rows from ${table}`,
    );
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
