import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';

import { TimestampUtil } from '@rexezuge/shared';
import { isD1DailyLimitError } from '@rexezuge/d1';
import { log } from '@aws-access-bridge/shared/utils/Logger';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { CronTask } from './CronTask';
import type { IEnv, TaskRunSummary } from './CronTask';
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
/**
 * How many database statements one account's collection is expected to cost.
 *
 * A ceiling, for the same reason the billing table is: the exact figure depends
 * on which regions answered and how many resources each returned, and the failure
 * mode of under-counting is an invocation the platform terminates with no error
 * anywhere — the rows are right, the suite is green, and the cron silently stops.
 */
const STATEMENTS_PER_ACCOUNT = 12;

abstract class AbstractCollectionTask<TEnv extends CollectionTaskEnv> extends CronTask<TEnv> {
  protected abstract collectionType(): 'cost' | 'resource';
  protected abstract maxAccountsPerCollection(): number;
  protected abstract collectionIntervalHours(env: TEnv): number;
  protected abstract sessionName(): string;
  protected abstract collectForAccount(principalArn: string, credentials: AccessKeys, accountId: string, env: TEnv): Promise<number>;

  protected override async handleScheduledTask(_event: ScheduledController, env: TEnv, _ctx: ExecutionContext): Promise<TaskRunSummary> {
    const intervalHours = this.collectionIntervalHours(env);
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - intervalHours * 3600;
    // Metered, unlike the request-path DAOs: this is the one loop in the
    // repository whose statement count is a function of how many accounts happen
    // to be due, so it is the one that can outgrow an invocation.
    const configDAO = new DataCollectionConfigDAO(env.AccessBridgeDB, this.meter);
    const principalArns: string[] = await configDAO.getPrincipalArnsNeedingCollection(
      this.collectionType(),
      this.maxAccountsPerCollection(),
      cutoffTime,
    );

    if (principalArns.length === 0) {
      return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };
    }

    // Refuse the whole batch up front rather than being terminated partway through
    // it. A run that dies on the platform's ceiling has already collected for some
    // accounts and stamped their attempt times, so the next cron skips them and the
    // remainder waits a full interval — a partial sweep that reads as a complete
    // one. The remaining accounts stay due, so this costs a delay rather than data.
    this.assertSubrequestBudget(principalArns.length * STATEMENTS_PER_ACCOUNT, `${this.collectionType()} collection`);
    log.warn(
      `[${this.collectionType()}] ${principalArns.length} accounts due; refusing if the invocation cannot afford ${principalArns.length * STATEMENTS_PER_ACCOUNT} statements.`,
    );

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
        // A spent daily write allowance is not a failure to retry — it cannot
        // change for hours, so retrying re-runs the whole failure path at the
        // alarm's rate and reports a transient fault for a scheduled pause. It is
        // the one error class here that is an *answer* rather than a symptom, so
        // it is asked about first and reported as what it is: the run stops with
        // the reason, and the accounts stay due for the next cron after the
        // reset rather than having their attempt times burned through it.
        const dailyLimit = isD1DailyLimitError(error);
        if (dailyLimit) {
          log.error(
            `[${this.collectionType()}] D1 daily write allowance exhausted; pausing until ${new Date(dailyLimit.resetsAt).toISOString()}. ${principalArns.length - failedAccounts - 1} account(s) remain due.`,
          );
          return {
            itemsProcessed: succeededItems,
            itemsFailed: failedAccounts,
            summary: `Paused: D1 daily write allowance exhausted until ${new Date(dailyLimit.resetsAt).toISOString()}`,
            details: { reason: 'd1-daily-limit', resetsAt: dailyLimit.resetsAt },
          };
        }
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
