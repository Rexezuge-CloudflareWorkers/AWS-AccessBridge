import { Pagination } from '@aws-access-bridge/backend-runtime/constants/Pagination';
import {
  AwsAccountsDAO,
  BackgroundTaskRunDAO,
  CostDataDAO,
  DataCollectionConfigDAO,
  ResourceInventoryDAO,
  RoleConfigsDAO,
  SpendAlertDAO,
  TeamAccountsDAO,
} from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { BackgroundTaskRun } from '@aws-access-bridge/shared/model';
import type { ServiceEnv } from '../composition/ServiceEnv';

import { log } from '@aws-access-bridge/shared/utils';
type MaintenanceServiceEnv = ServiceEnv;

interface OrphanCleanupCounts {
  dataCollectionConfig: number;
  roleConfigs: number;
  teamAccounts: number;
  spendAlerts: number;
  costData: number;
  resourceInventory: number;
  awsAccounts: number;
}

interface OrphanCleanupFailure {
  /**
  Which table's delete failed.
  */
  table: keyof OrphanCleanupCounts;
  error: string;
}

interface OrphanCleanupResult {
  deletedCounts: OrphanCleanupCounts;
  totalDeleted: number;
  /**
   * Per-table failures.
   *
   * The deletes ran independently and a failure in one no longer aborts the rest,
   * so this reports what did not happen. Empty on a clean run.
   */
  failures: OrphanCleanupFailure[];
}

class MaintenanceService {
  constructor(private readonly env: MaintenanceServiceEnv) {}

  /**
   * Delete every orphaned row, reporting per-table outcomes.
   *
   * Each table's delete is settled independently. They used to run in sequence,
   * so the first failure aborted the remaining six and the caller saw a 500 with
   * no indication of how far it got — and, once the DAOs gained their
   * `result.success` checks, a partial run could report success. A failure in one
   * table says nothing about the others, so there is no reason to stop.
   */
  public async cleanupOrphanedData(): Promise<OrphanCleanupResult> {
    const db: D1Queryable = this.env.AccessBridgeDB;

    const steps: Array<[keyof OrphanCleanupCounts, () => Promise<number>]> = [
      ['dataCollectionConfig', () => new DataCollectionConfigDAO(db).deleteOrphaned()],
      ['roleConfigs', () => new RoleConfigsDAO(db).deleteOrphaned()],
      ['teamAccounts', () => new TeamAccountsDAO(db).deleteOrphaned()],
      ['spendAlerts', () => new SpendAlertDAO(db).deleteOrphaned()],
      ['costData', () => new CostDataDAO(db).deleteOrphaned()],
      ['resourceInventory', () => new ResourceInventoryDAO(db).deleteOrphaned()],
      ['awsAccounts', () => new AwsAccountsDAO(db).deleteOrphaned()],
    ];

    const settled = await Promise.allSettled(steps.map(([, run]) => run()));
    const deletedCounts = {} as OrphanCleanupCounts;
    const failures: OrphanCleanupFailure[] = [];
    settled.forEach((result, index) => {
      const table = steps[index][0];
      if (result.status === 'fulfilled') {
        deletedCounts[table] = result.value;
        return;
      }
      // 0 is a safe floor: the table's rows are still there, and reporting a
      // partial count would be worse than reporting none.
      deletedCounts[table] = 0;
      failures.push({ table, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      log.error(`Orphan cleanup failed for ${table}`, { table });
    });

    const totalDeleted: number = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);
    return { deletedCounts, totalDeleted, failures };
  }

  public async listTaskRuns(options: { taskType?: string; status?: string; limit?: number }): Promise<BackgroundTaskRun[]> {
    const dao: BackgroundTaskRunDAO = new BackgroundTaskRunDAO(this.env.AccessBridgeDB);
    // Clamped in the service as well as at the route, because `Pagination` lives
    // in `backend-runtime` (Layer 1) and the DAO is in `backend-data` (Layer 2),
    // which must not import upward. The service is the layer that may.
    return dao.listRuns({ taskType: options.taskType, status: options.status, limit: Pagination.limit(options?.limit) });
  }
}export { MaintenanceService };
export type { MaintenanceServiceEnv, OrphanCleanupCounts, OrphanCleanupResult };
