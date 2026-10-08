import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';

import { log, TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';
import { createRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

interface CollectionTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeDB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
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
 *
 * Builds a fresh scope per run rather than using `getRequestScope`: a Durable
 * Object's `env` is stable for the object's lifetime, so an env-keyed cache would
 * pin the memoized encryption keys for as long as the object lives — after a key
 * rotation the cron would keep encrypting with the old key while the API worker,
 * on a fresh scope per request, had moved on.
 */
abstract class AbstractCollectionTask<TEnv extends CollectionTaskEnv> extends IScheduledTask<TEnv> {
  protected abstract collectionType(): 'cost' | 'resource';
  protected abstract maxAccountsPerCollection(): number;
  protected abstract collectionIntervalHours(env: TEnv): number;
  protected abstract sessionName(): string;
  protected abstract collectForAccount(principalArn: string, credentials: AccessKeys, accountId: string, env: TEnv): Promise<number>;

  protected override async handleScheduledTask(_event: ScheduledController, env: TEnv, _ctx: ExecutionContext): Promise<TaskRunSummary> {
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

    const credentialChain = createRequestScope(env).get(Tokens.CredentialChainService);
    let succeededItems = 0;
    let failedAccounts = 0;
    for (const principalArn of principalArns) {
      try {
        const { credentials }: { credentials: AccessKeys } = await credentialChain.resolveLeafCredentials(principalArn, this.sessionName());
        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        const collected: number = await this.collectForAccount(principalArn, credentials, accountId, env);
        succeededItems += collected;
        // Stamp the attempt on every outcome — success, empty or failure — or
        // a permanently failing principal stays due and occupies the front of
        // every batch, starving the healthy principals behind it. The success
        // clock advances only when data actually arrived.
        try {
          await configDAO.updateLastAttemptTime(principalArn, this.collectionType());
        } catch (error: unknown) {
          failedAccounts += 1;
          log.error(`Failed to stamp attempt time for ${principalArn}:`, { error: error });
          continue;
        }
        if (collected > 0) {
          await configDAO.updateLastCollectedTime(principalArn, this.collectionType());
        } else {
          log.warn(
            `[${this.collectionType()}] ${principalArn} reported no data; last_attempt_at advanced, last_collected_at left untouched.`,
          );
        }
      } catch (error: unknown) {
        failedAccounts += 1;
        log.error(`Failed to collect ${this.collectionType()} data for ${principalArn}:`, { error: error });
        try {
          await configDAO.updateLastAttemptTime(principalArn, this.collectionType());
        } catch (stampError: unknown) {
          log.error(`Failed to stamp attempt time for ${principalArn}:`, { error: stampError });
        }
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
