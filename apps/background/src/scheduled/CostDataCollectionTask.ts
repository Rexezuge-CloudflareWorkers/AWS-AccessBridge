import { CostDataDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { createRequestScope, Tokens } from '@aws-access-bridge/backend-services/composition';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { MoneyUtil } from '@aws-access-bridge/shared/utils/MoneyUtil';
import type { AccessKeys, CostData } from '@aws-access-bridge/shared/model';
import { AbstractCollectionTask } from './AbstractCollectionTask';
import type { CollectionTaskEnv } from './AbstractCollectionTask';

const MAX_ACCOUNTS_PER_COLLECTION: number = 3;

class CostDataCollectionTask extends AbstractCollectionTask<CostDataCollectionTaskEnv> {
  protected override getTaskType(): string {
    return 'cost-data-collection';
  }

  protected collectionType(): 'cost' {
    return 'cost';
  }

  protected maxAccountsPerCollection(): number {
    return MAX_ACCOUNTS_PER_COLLECTION;
  }

  protected collectionIntervalHours(env: CostDataCollectionTaskEnv): number {
    return ConfigurationManager.costs.getCollectionIntervalHours(env);
  }

  protected sessionName(): string {
    return 'AccessBridge-CostCollection';
  }

  protected override async collectForAccount(
    principalArn: string,
    credentials: AccessKeys,
    accountId: string,
    env: CostDataCollectionTaskEnv,
  ): Promise<number> {
    const lookbackDays: number = ConfigurationManager.costs.getLookbackDays(env);
    // Resolved from the composition root rather than constructed directly: a fresh
    // scope per run, because a Durable Object's `env` is stable for the object's
    // lifetime and a cached scope would pin the memoized encryption keys after a
    // rotation. Consistent with `AbstractCollectionTask`'s own scope usage.
    const scope = createRequestScope(env);
    const costExplorer = scope.get(Tokens.CostExplorerService);
    const costDataDAO = new CostDataDAO(env.AccessBridgeDB);

    const { startDate, endDate } = MoneyUtil.lookbackWindow(lookbackDays);

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

    console.log(`Cost data collected for ${principalArn}: ${results.length} periods`);
    // The number of periods written, not a constant: `AbstractCollectionTask` reads
    // this both to advance the collection interval (only when non-zero) and to fill
    // `background_task_runs.items_processed`, which was otherwise a meaningless 1.
    return results.length;
  }
}

interface CostDataCollectionTaskEnv extends CollectionTaskEnv {
  COST_COLLECTION_INTERVAL_HOURS?: string;
  COST_LOOKBACK_DAYS?: string;
}

export { CostDataCollectionTask };
export type { CostDataCollectionTaskEnv };
