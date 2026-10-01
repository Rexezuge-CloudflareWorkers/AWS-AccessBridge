import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaintenanceService } from '@aws-access-bridge/backend-services/maintenance/MaintenanceService';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';
import { SpendAlertDAO } from '@aws-access-bridge/backend-data/dao/SpendAlertDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';

vi.mock('@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO');
vi.mock('@aws-access-bridge/backend-data/dao/RoleConfigsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/SpendAlertDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CostDataDAO');
vi.mock('@aws-access-bridge/backend-data/dao/ResourceInventoryDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');

const ENV = { AccessBridgeDB: {} } as never;

const TABLES = {
  dataCollectionConfig: DataCollectionConfigDAO,
  roleConfigs: RoleConfigsDAO,
  teamAccounts: TeamAccountsDAO,
  spendAlerts: SpendAlertDAO,
  costData: CostDataDAO,
  resourceInventory: ResourceInventoryDAO,
  awsAccounts: AwsAccountsDAO,
} as const;

/** Give each table a distinct count so a mis-wired total is visible. */
function distinctCountsPerTable(): void {
  for (const [index, dao] of Object.values(TABLES).entries()) {
    vi.mocked(dao.prototype.deleteOrphaned).mockResolvedValue(index + 1);
  }
}

describe('MaintenanceService.cleanupOrphanedData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const dao of Object.values(TABLES)) {
      vi.mocked(dao.prototype.deleteOrphaned).mockResolvedValue(1);
    }
  });

  it('reports a per-table count and the total on a clean run', async () => {
    const result = await new MaintenanceService(ENV).cleanupOrphanedData();
    expect(result.failures).toEqual([]);
    expect(result.totalDeleted).toBe(7);
    expect(result.deletedCounts).toEqual({
      dataCollectionConfig: 1,
      roleConfigs: 1,
      teamAccounts: 1,
      spendAlerts: 1,
      costData: 1,
      resourceInventory: 1,
      awsAccounts: 1,
    });
  });

  /**
   * Regression: the seven deletes ran in sequence, so the first failure aborted the
   * remaining six and the caller saw a 500 with no indication of how far it got.
   * Combined with the DAOs' new `result.success` checks — which is what surfaced
   * the sequence order as a real risk — a single busy table blocked all cleanup.
   */
  it('completes the other tables when one fails, and names the failure', async () => {
    vi.mocked(RoleConfigsDAO.prototype.deleteOrphaned).mockRejectedValue(new Error('database is locked'));

    const result = await new MaintenanceService(ENV).cleanupOrphanedData();

    // The failure did not abort the rest.
    expect(DataCollectionConfigDAO.prototype.deleteOrphaned).toHaveBeenCalled();
    expect(AwsAccountsDAO.prototype.deleteOrphaned).toHaveBeenCalled();
    expect(result.failures).toEqual([{ table: 'roleConfigs', error: 'database is locked' }]);
    // 0 rather than a partial guess: the table's rows are all still there.
    expect(result.deletedCounts.roleConfigs).toBe(0);
    expect(result.totalDeleted).toBe(6);
  });

  it('isolates multiple simultaneous failures', async () => {
    vi.mocked(CostDataDAO.prototype.deleteOrphaned).mockRejectedValue(new Error('cost failed'));
    vi.mocked(SpendAlertDAO.prototype.deleteOrphaned).mockRejectedValue(new Error('alert failed'));

    const result = await new MaintenanceService(ENV).cleanupOrphanedData();

    expect(result.failures.map((failure) => failure.table).toSorted()).toEqual(['costData', 'spendAlerts']);
    expect(result.totalDeleted).toBe(5);
  });

  it('still reports every table when all seven fail', async () => {
    for (const dao of Object.values(TABLES)) {
      vi.mocked(dao.prototype.deleteOrphaned).mockRejectedValue(new Error('d1 is down'));
    }

    const result = await new MaintenanceService(ENV).cleanupOrphanedData();

    expect(result.failures).toHaveLength(7);
    expect(result.totalDeleted).toBe(0);
  });

  it('logs each failure, since a 200 does not look like a failure in a log tail', async () => {
    vi.mocked(CostDataDAO.prototype.deleteOrphaned).mockRejectedValue(new Error('cost failed'));
    await new MaintenanceService(ENV).cleanupOrphanedData();
    expect(console.error).toHaveBeenCalledWith('Orphan cleanup failed for costData:', expect.any(Error));
  });

  it('sums distinct per-table counts, so a mis-wired total is visible', async () => {
    distinctCountsPerTable();
    const result = await new MaintenanceService(ENV).cleanupOrphanedData();
    // The helper assigns 1..7 in declaration order: 1+2+3+4+5+6+7.
    expect(result.totalDeleted).toBe(28);
    expect(result.failures).toEqual([]);
  });
});
