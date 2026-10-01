import { CredentialCacheConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { getRequestScope, Tokens } from '@aws-access-bridge/backend-services/composition';
import type { CredentialChainService } from '@aws-access-bridge/backend-services/credential';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
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
    const chainService = getRequestScope(env).get(Tokens.CredentialChainService);
    const credentialsCacheDAO = await chainService.createCacheDAO();
    const sts = new StsService();
    const principalArns: string[] = await credentialCacheConfigDAO.getPrincipalArnsNeedingUpdate(refreshBatchSize, cutoffTime);
    let refreshedCount: number = 0;
    let failedCount: number = 0;
    for (const principalArn of principalArns) {
      // Isolate per principal: one unresolvable chain (e.g. a credentials row
      // deleted out from under a stale cache_config entry) must not abort the
      // remaining principals in the batch.
      try {
        const refreshedForPrincipal: number = await this.refreshPrincipal(principalArn, chainService, sts, credentialsCacheDAO, credentialCacheConfigDAO);
        refreshedCount += refreshedForPrincipal;
      } catch (error: unknown) {
        failedCount += 1;
        console.error(`[CredentialCacheRefreshTask] Failed to refresh ${principalArn}:`, error);
      }
    }
    return {
      itemsProcessed: refreshedCount,
      itemsFailed: failedCount,
      summary: `Refreshed ${refreshedCount} cached credentials, ${failedCount} principal(s) failed`,
    };
  }

  private async refreshPrincipal(
    principalArn: string,
    chainService: CredentialChainService,
    sts: StsService,
    credentialsCacheDAO: { storeCachedCredential(credential: CredentialCache): Promise<void> },
    credentialCacheConfigDAO: CredentialCacheConfigDAO,
  ): Promise<number> {
    const credentialChain: CredentialChain = await chainService.getCredentialChain(principalArn);
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
      const assumedCredentials: AccessKeysWithExpiration = await sts.assumeRole(roleArn, credential, CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME);
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
    // Advanced once per principal, after the walk, rather than per hop: a
    // single-hop chain has nothing cacheable but still resolved fine, and
    // bumping it per hop would leave it permanently due and re-resolve the chain
    // on every cron tick forever.
    await credentialCacheConfigDAO.updateLastCachedTime(principalArn);
    return refreshed;
  }
}

interface CredentialCacheRefreshTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_REFRESH_INTERVAL_MINUTES?: string;
  NUMBER_OF_CREDENTIALS_TO_REFRESH?: string;
  AccessBridgeDB: D1Database;
  AccessBridgeKV: KVNamespace;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { CredentialCacheRefreshTask };
