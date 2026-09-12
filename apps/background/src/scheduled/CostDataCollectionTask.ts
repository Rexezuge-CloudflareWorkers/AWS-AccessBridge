import { CostDataDAO, DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CostExplorerService } from '@aws-access-bridge/backend-services/aws/ce';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';
import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { AccessKeys, CostData } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';

const MAX_ACCOUNTS_PER_COLLECTION: number = 3;

class CostDataCollectionTask extends IScheduledTask<CostDataCollectionTaskEnv> {
  protected override getTaskType(): string {
    return 'cost-data-collection';
  }

  protected async handleScheduledTask(
    _event: ScheduledController,
    env: CostDataCollectionTaskEnv,
    _ctx: ExecutionContext,
  ): Promise<TaskRunSummary> {
    const intervalHours: number = ConfigurationManager.costs.getCollectionIntervalHours(env);
    const lookbackDays: number = ConfigurationManager.costs.getLookbackDays(env);
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - intervalHours * 3600;
    const dataCollectionConfigDAO: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    const principalArns: string[] = await dataCollectionConfigDAO.getPrincipalArnsNeedingCollection(
      'cost',
      MAX_ACCOUNTS_PER_COLLECTION,
      cutoffTime,
    );

    if (principalArns.length === 0) return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };

    const credentialService = CredentialServiceFactory.create(env);
    const costExplorer = new CostExplorerService();
    const costDataDAO: CostDataDAO = new CostDataDAO(env.AccessBridgeDB);

    const endDate: string = new Date().toISOString().split('T', 1)[0];
    const startDate: string = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().split('T', 1)[0];

    let succeededCount: number = 0;
    let failedCount: number = 0;
    for (const principalArn of principalArns) {
      try {
        const { credentials }: { credentials: AccessKeys } = await credentialService.resolveLeafCredentials(
          principalArn,
          'AccessBridge-CostCollection',
        );

        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        const results = await costExplorer.getCostAndUsage(credentials, startDate, endDate, 'DAILY');

        for (const result of results) {
          const costData: CostData = {
            awsAccountId: accountId,
            periodStart: result.periodStart,
            periodEnd: result.periodEnd,
            totalCost: result.totalCost,
            currency: result.currency,
            serviceBreakdown: result.serviceBreakdown,
            collectedAt: TimestampUtil.getCurrentUnixTimestampInSeconds(),
          };
          await costDataDAO.upsertCostData(costData);
        }

        await dataCollectionConfigDAO.updateLastCollectedTime(principalArn, 'cost');
        succeededCount += 1;
        console.log(`Cost data collected for ${principalArn}: ${results.length} periods`);
      } catch (error: unknown) {
        failedCount += 1;
        console.error(`Failed to collect cost data for ${principalArn}:`, error);
      }
    }
    return {
      itemsProcessed: succeededCount,
      itemsFailed: failedCount,
      summary: `Collected cost data for ${succeededCount} accounts (${failedCount} failed)`,
    };
  }
}

interface CostDataCollectionTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  COST_COLLECTION_INTERVAL_HOURS?: string;
  COST_LOOKBACK_DAYS?: string;
  AccessBridgeDB: D1Database;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  AccessBridgeKV: KVNamespace;
}

export { CostDataCollectionTask };
