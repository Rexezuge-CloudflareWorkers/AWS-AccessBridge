import { CredentialsDAO, CostDataDAO, DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { AssumeRoleUtil, AwsApiUtil } from '@aws-access-bridge/backend-services/aws';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { CredentialChain, AccessKeys, AccessKeysWithExpiration, CostData } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@aws-access-bridge/backend-runtime/config';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws';

const COST_COLLECTION_INTERVAL_HOURS: number = 6;
const MAX_ACCOUNTS_PER_COLLECTION: number = 3;
const COST_LOOKBACK_DAYS: number = 30;

class CostDataCollectionTask extends IScheduledTask<CostDataCollectionTaskEnv> {
  protected override getTaskType(): string {
    return 'cost-data-collection';
  }

  protected async handleScheduledTask(
    _event: ScheduledController,
    env: CostDataCollectionTaskEnv,
    _ctx: ExecutionContext,
  ): Promise<TaskRunSummary> {
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - COST_COLLECTION_INTERVAL_HOURS * 3600;
    const dataCollectionConfigDAO: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    const principalArns: string[] = await dataCollectionConfigDAO.getPrincipalArnsNeedingCollection(
      'cost',
      MAX_ACCOUNTS_PER_COLLECTION,
      cutoffTime,
    );

    if (principalArns.length === 0) return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsDAO: CredentialsDAO = new CredentialsDAO(env.AccessBridgeDB, masterKey, principalTrustChainLimit);
    const costDataDAO: CostDataDAO = new CostDataDAO(env.AccessBridgeDB);

    const endDate: string = new Date().toISOString().split('T', 1)[0];
    const startDate: string = new Date(Date.now() - COST_LOOKBACK_DAYS * 86_400_000).toISOString().split('T', 1)[0];

    let succeededCount: number = 0;
    let failedCount: number = 0;
    for (const principalArn of principalArns) {
      try {
        const credentialChain: CredentialChain = await credentialsDAO.getCredentialChainByPrincipalArn(principalArn);
        let credential: AccessKeys = {
          accessKeyId: credentialChain.accessKeyId,
          secretAccessKey: credentialChain.secretAccessKey,
          sessionToken: credentialChain.sessionToken,
        };

        for (let i = credentialChain.principalArns.length - 2; i >= 0; i--) {
          const roleArn: string = credentialChain.principalArns[i];
          const assumed: AccessKeysWithExpiration = await AssumeRoleUtil.assumeRole(roleArn, credential, 'AccessBridge-CostCollection');
          credential = assumed;
        }

        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        const results = await AwsApiUtil.getCostAndUsage(credential, startDate, endDate, 'DAILY');

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
  AccessBridgeDB: D1Database;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { CostDataCollectionTask };
