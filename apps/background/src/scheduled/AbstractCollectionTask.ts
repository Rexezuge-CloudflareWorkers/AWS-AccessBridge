import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';
import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';

interface CollectionTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeDB: D1Database;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  AccessBridgeKV: KVNamespace;
  [key: string]: unknown;
}

/**
 * Abstract Template for per-account collection tasks (Otter
 * `BaseDriveSyncTask` precedent). Previously `CostDataCollectionTask`
 * vs `ResourceInventoryCollectionTask` duplicated the
 * `getPrincipalArnsNeedingCollection → resolveLeafCredentials →
 * updateLastCollectedTime` loop; only per-item work differed.
 * Subclasses implement `collectionType`, `maxAccounts`, `intervalHours`,
 * and `collectForAccount`.
 */
abstract class AbstractCollectionTask<TEnv extends CollectionTaskEnv> extends IScheduledTask<TEnv> {
  protected abstract collectionType(): 'cost' | 'resource';
  protected abstract maxAccountsPerCollection(): number;
  protected abstract collectionIntervalHours(env: TEnv): number;
  protected abstract sessionName(): string;
  protected abstract collectForAccount(principalArn: string, credentials: AccessKeys, accountId: string, env: TEnv): Promise<number>;

  protected override async handleScheduledTask(
    _event: ScheduledController,
    env: TEnv,
    _ctx: ExecutionContext,
  ): Promise<TaskRunSummary> {
    const intervalHours = this.collectionIntervalHours(env);
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - intervalHours * 3600;
    const configDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    const principalArns: string[] = await configDAO.getPrincipalArnsNeedingCollection(
      this.collectionType(),
      this.maxAccountsPerCollection(),
      cutoffTime,
    );

    if (principalArns.length === 0) {
      return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };
    }

    const credentialService = CredentialServiceFactory.create(env);
    let succeededItems = 0;
    let failedAccounts = 0;
    for (const principalArn of principalArns) {
      try {
        const { credentials }: { credentials: AccessKeys } = await credentialService.resolveLeafCredentials(
          principalArn,
          this.sessionName(),
        );
        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        succeededItems += await this.collectForAccount(principalArn, credentials, accountId, env);
        await configDAO.updateLastCollectedTime(principalArn, this.collectionType());
      } catch (error: unknown) {
        failedAccounts += 1;
        console.error(`Failed to collect ${this.collectionType()} data for ${principalArn}:`, error);
      }
    }
    return {
      itemsProcessed: succeededItems,
      itemsFailed: failedAccounts,
      summary: `Collected ${this.collectionType()} data for ${principalArns.length - failedAccounts} accounts (${failedAccounts} failed)`,
    };
  }
}

export { AbstractCollectionTask };
export type { CollectionTaskEnv };
