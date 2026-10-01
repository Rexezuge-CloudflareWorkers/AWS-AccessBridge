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
  constructor(
    database: D1Queryable,
    protected readonly masterKey: string,
  ) {
    super(database);
  }
}

export { BaseDAO, EncryptedDAO };
