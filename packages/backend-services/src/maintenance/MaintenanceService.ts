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

interface MaintenanceServiceEnv {
  AccessBridgeDB: D1Queryable;
}

interface OrphanCleanupCounts {
  dataCollectionConfig: number;
  roleConfigs: number;
  teamAccounts: number;
  spendAlerts: number;
  costData: number;
  resourceInventory: number;
  awsAccounts: number;
}

interface OrphanCleanupResult {
  deletedCounts: OrphanCleanupCounts;
  totalDeleted: number;
}

class MaintenanceService {
  constructor(private readonly env: MaintenanceServiceEnv) {}

  public async cleanupOrphanedData(): Promise<OrphanCleanupResult> {
    const db: D1Queryable = this.env.AccessBridgeDB;

    const dataCollectionConfig: number = await new DataCollectionConfigDAO(db).deleteOrphaned();
    const roleConfigs: number = await new RoleConfigsDAO(db).deleteOrphaned();
    const teamAccounts: number = await new TeamAccountsDAO(db).deleteOrphaned();
    const spendAlerts: number = await new SpendAlertDAO(db).deleteOrphaned();
    const costData: number = await new CostDataDAO(db).deleteOrphaned();
    const resourceInventory: number = await new ResourceInventoryDAO(db).deleteOrphaned();
    const awsAccounts: number = await new AwsAccountsDAO(db).deleteOrphaned();

    const deletedCounts: OrphanCleanupCounts = {
      dataCollectionConfig,
      roleConfigs,
      teamAccounts,
      spendAlerts,
      costData,
      resourceInventory,
      awsAccounts,
    };
    const totalDeleted: number =
      dataCollectionConfig + roleConfigs + teamAccounts + spendAlerts + costData + resourceInventory + awsAccounts;

    return { deletedCounts, totalDeleted };
  }

  public async listTaskRuns(options: { taskType?: string; status?: string; limit?: number }): Promise<BackgroundTaskRun[]> {
    const dao: BackgroundTaskRunDAO = new BackgroundTaskRunDAO(this.env.AccessBridgeDB);
    return dao.listRuns({ taskType: options.taskType, status: options.status, limit: options.limit });
  }
}

class MaintenanceServiceFactory {
  public static create(env: MaintenanceServiceEnv): MaintenanceService {
    return new MaintenanceService(env);
  }
}

export { MaintenanceService, MaintenanceServiceFactory };
export type { MaintenanceServiceEnv, OrphanCleanupCounts, OrphanCleanupResult };
