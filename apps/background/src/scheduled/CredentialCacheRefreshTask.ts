import { CredentialCacheConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { createRequestScope, Tokens } from '@aws-access-bridge/backend-services/composition';
import type { CredentialChainService } from '@aws-access-bridge/backend-services/credential';
import type { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { ForbiddenError } from '@aws-access-bridge/backend-errors';
import { log, TimestampUtil } from '@aws-access-bridge/shared/utils';
import { CredentialChain, CredentialCache, AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';
import { CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME } from '@aws-access-bridge/shared/constants';

class CredentialCacheRefreshTask extends IScheduledTask<CredentialCacheRefreshTaskEnv> {
  protected override getTaskType(): string {
    return 'credential-cache-refresh';
  }

  protected async handleScheduledTask(
    _event: ScheduledController,
    env: CredentialCacheRefreshTaskEnv,
    _ctx: ExecutionContext,
  ): Promise<TaskRunSummary> {
    const refreshIntervalMinutes: number = ConfigurationManager.credential.getRefreshIntervalMinutes(env);
    const refreshBatchSize: number = ConfigurationManager.credential.getRefreshBatchSize(env);
    const cutoffTime: number = TimestampUtil.subtractMinutes(TimestampUtil.getCurrentUnixTimestampInSeconds(), refreshIntervalMinutes);
    const credentialCacheConfigDAO: CredentialCacheConfigDAO = new CredentialCacheConfigDAO(env.AccessBridgeDB);
    // A fresh scope per run, not `getRequestScope`: a Durable Object's `env` is
    // stable for the object's lifetime, so a cached scope would pin the memoized
    // encryption keys and the cron would keep using the old key after a rotation.
    const scope = createRequestScope(env);
    const chainService = scope.get(Tokens.CredentialChainService);
    const credentialsCacheDAO = await chainService.createCacheDAO();
    // Resolved from the scope rather than constructed directly, so the composition
    // root stays the single place services are built — a test can substitute the
    // STS client through the token instead of the global being unreachable.
    const sts = scope.get(Tokens.StsService);
    const principalArns: string[] = await credentialCacheConfigDAO.getPrincipalArnsNeedingUpdate(refreshBatchSize, cutoffTime);
    let refreshedCount: number = 0;
    let failedCount: number = 0;
    let skippedCount: number = 0;
    for (const principalArn of principalArns) {
      // Isolate per principal: one unresolvable chain (e.g. a credentials row
      // deleted out from under a stale cache_config entry) must not abort the
      // remaining principals in the batch.
      let failed: boolean = false;
      try {
        const refreshedForPrincipal: number | null = await this.refreshPrincipal(principalArn, chainService, sts, credentialsCacheDAO);
        if (refreshedForPrincipal === null) {
          skippedCount += 1;
        } else {
          refreshedCount += refreshedForPrincipal;
        }
      } catch (error: unknown) {
        failed = true;
        failedCount += 1;
        log.error(`[CredentialCacheRefreshTask] Failed to refresh ${principalArn}:`, { error: error });
      }
      // Stamped whatever happened above, once per principal and after the walk. The
      // batch is ordered oldest-first, so a row that fails without being stamped sorts
      // first again on the next tick: enough broken rows then occupy the whole batch
      // and the healthy ones behind them are never refreshed. The failure is still
      // logged and counted; the stamp only moves the retry to the next interval.
      try {
        await credentialCacheConfigDAO.updateLastCachedTime(principalArn);
      } catch (error: unknown) {
        if (!failed) failedCount += 1;
        log.error(`[CredentialCacheRefreshTask] Failed to advance last_cached_at for ${principalArn}:`, { error: error });
      }
    }
    return {
      itemsProcessed: refreshedCount,
      itemsFailed: failedCount,
      summary: `Refreshed ${refreshedCount} cached credentials, ${failedCount} principal(s) failed, ${skippedCount} skipped`,
    };
  }

  private async refreshPrincipal(
    principalArn: string,
    chainService: CredentialChainService,
    sts: StsService,
    credentialsCacheDAO: { storeCachedCredential(credential: CredentialCache): Promise<void> },
  ): Promise<number | null> {
    let credentialChain: CredentialChain;
    try {
      credentialChain = await chainService.getCredentialChain(principalArn);
    } catch (error: unknown) {
      // Only the chain resolution's own refusal of a one-hop chain is a skip: a base
      // principal registered before registration moved to the relationship step has
      // nothing to pre-warm and nothing wrong. Anything else is a real failure.
      if (error instanceof ForbiddenError) {
        log.info(`[CredentialCacheRefreshTask] ${principalArn} has no intermediate hop to pre-warm; skipping.`);
        return null;
      }
      throw error;
    }
    let credential: AccessKeys = {
      accessKeyId: credentialChain.accessKeyId,
      secretAccessKey: credentialChain.secretAccessKey,
      sessionToken: credentialChain.sessionToken,
    };
    let refreshed: number = 0;
    // `principalArns[0]` is the target role and the highest index is the base IAM
    // user; the walk runs base -> target, mirroring `AssumeRoleService.assumeRoleChain`.
    // Only the *intermediate* hops are pre-warmed: index 0 is the role the caller
    // is asking for (never reused), and index `length - 1` is the base's own
    // long-term keys, which `assumeRoleChain` does not assume from.
    for (let i = credentialChain.principalArns.length - 2; i > 0; i--) {
      const roleArn: string = credentialChain.principalArns[i];
      const assumedCredentials: AccessKeysWithExpiration = await sts.assumeRole(
        roleArn,
        credential,
        CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME,
      );
      if (assumedCredentials.sessionToken && assumedCredentials.expiration) {
        await credentialsCacheDAO.storeCachedCredential({
          principalArn: roleArn,
          accessKeyId: assumedCredentials.accessKeyId,
          secretAccessKey: assumedCredentials.secretAccessKey,
          sessionToken: assumedCredentials.sessionToken,
          expiresAt: TimestampUtil.convertIsoToUnixTimestampInSeconds(assumedCredentials.expiration),
        });
        refreshed += 1;
      }
      credential = assumedCredentials;
    }
    return refreshed;
  }
}

interface CredentialCacheRefreshTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_REFRESH_INTERVAL_MINUTES?: string;
  NUMBER_OF_CREDENTIALS_TO_REFRESH?: string;
  AccessBridgeDB: D1Database;
  AccessBridgeKV: KVNamespace;
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { CredentialCacheRefreshTask };
