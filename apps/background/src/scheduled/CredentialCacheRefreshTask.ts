import { CredentialCacheConfigDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
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
    const credentialService = CredentialServiceFactory.create(env);
    const credentialsCacheDAO = await credentialService.createCacheDAO();
    const sts = new StsService();
    const principalArns: string[] = await credentialCacheConfigDAO.getPrincipalArnsNeedingUpdate(refreshBatchSize, cutoffTime);
    let refreshedCount: number = 0;
    for (const principalArn of principalArns) {
      const credentialChain: CredentialChain = await credentialService.getCredentialChain(principalArn);
      let credential: AccessKeys = {
        accessKeyId: credentialChain.accessKeyId,
        secretAccessKey: credentialChain.secretAccessKey,
        sessionToken: credentialChain.sessionToken,
      };
      for (let i = credentialChain.principalArns.length - 2; i >= 0; i--) {
        const roleArn: string = credentialChain.principalArns[i];
        const assumedCredentials: AccessKeysWithExpiration = await sts.assumeRole(
          roleArn,
          credential,
          CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME,
        );
        if (assumedCredentials.sessionToken && assumedCredentials.expiration) {
          const credentialCache: CredentialCache = {
            principalArn,
            accessKeyId: assumedCredentials.accessKeyId,
            secretAccessKey: assumedCredentials.secretAccessKey,
            sessionToken: assumedCredentials.sessionToken,
            expiresAt: TimestampUtil.convertIsoToUnixTimestampInSeconds(assumedCredentials.expiration),
          };
          await Promise.all([
            credentialsCacheDAO.storeCachedCredential(credentialCache),
            credentialCacheConfigDAO.updateLastCachedTime(principalArn),
          ]);
          refreshedCount += 1;
        }
        credential = assumedCredentials;
      }
    }
    return { itemsProcessed: refreshedCount, itemsFailed: 0, summary: `Refreshed ${refreshedCount} cached credentials` };
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
