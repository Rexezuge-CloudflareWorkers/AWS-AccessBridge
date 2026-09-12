import { CredentialsDAO, DataCollectionConfigDAO, ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import { AssumeRoleUtil, AwsApiUtil, ArnUtil } from '@aws-access-bridge/backend-services/aws';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { CredentialChain, AccessKeys, AccessKeysWithExpiration, ResourceInventoryItem } from '@aws-access-bridge/shared/model';
import type { ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws/AwsApiUtil';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@aws-access-bridge/backend-runtime/config';

const RESOURCE_COLLECTION_INTERVAL_HOURS: number = 2;
const MAX_ACCOUNTS_PER_COLLECTION: number = 2;

class ResourceInventoryCollectionTask extends IScheduledTask<ResourceInventoryCollectionTaskEnv> {
  protected override getTaskType(): string {
    return 'resource-inventory-collection';
  }

  protected async handleScheduledTask(
    _event: ScheduledController,
    env: ResourceInventoryCollectionTaskEnv,
    _ctx: ExecutionContext,
  ): Promise<TaskRunSummary> {
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - RESOURCE_COLLECTION_INTERVAL_HOURS * 3600;
    const dataCollectionConfigDAO: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    const principalArns: string[] = await dataCollectionConfigDAO.getPrincipalArnsNeedingCollection(
      'resource',
      MAX_ACCOUNTS_PER_COLLECTION,
      cutoffTime,
    );

    if (principalArns.length === 0) return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsDAO: CredentialsDAO = new CredentialsDAO(env.AccessBridgeDB, masterKey, principalTrustChainLimit);
    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(env.AccessBridgeDB);

    let collectedCount: number = 0;
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
          const assumed: AccessKeysWithExpiration = await AssumeRoleUtil.assumeRole(roleArn, credential, 'AccessBridge-ResourceCollection');
          credential = assumed;
        }

        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        const collectedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();

        // Collect from multiple services
        const allItems: ResourceDiscoveryItem[] = [];
        try {
          allItems.push(...(await AwsApiUtil.describeInstances(credential)));
        } catch (e) {
          console.warn('EC2 collection failed:', e);
        }
        try {
          allItems.push(...(await AwsApiUtil.listBuckets(credential)));
        } catch (e) {
          console.warn('S3 collection failed:', e);
        }
        try {
          allItems.push(...(await AwsApiUtil.listFunctions(credential)));
        } catch (e) {
          console.warn('Lambda collection failed:', e);
        }
        try {
          allItems.push(...(await AwsApiUtil.describeDBInstances(credential)));
        } catch (e) {
          console.warn('RDS collection failed:', e);
        }
        try {
          allItems.push(...(await AwsApiUtil.listTables(credential)));
        } catch (e) {
          console.warn('DynamoDB collection failed:', e);
        }

        for (const item of allItems) {
          const resource: ResourceInventoryItem = {
            awsAccountId: accountId,
            region: item.region,
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            resourceName: item.resourceName,
            state: item.state,
            metadata: item.metadata,
            collectedAt,
          };
          await resourceDAO.upsertResource(resource);
        }

        // Clean stale resources
        for (const type of ['ec2', 's3', 'lambda', 'rds', 'dynamodb']) {
          await resourceDAO.deleteStaleResources(accountId, type, collectedAt);
        }

        await dataCollectionConfigDAO.updateLastCollectedTime(principalArn, 'resource');
        collectedCount += allItems.length;
        console.log(`Resource inventory collected for ${principalArn}: ${allItems.length} resources`);
      } catch (error: unknown) {
        failedCount += 1;
        console.error(`Failed to collect resources for ${principalArn}:`, error);
      }
    }
    return {
      itemsProcessed: collectedCount,
      itemsFailed: failedCount,
      summary: `Collected ${collectedCount} resources (${failedCount} accounts failed)`,
    };
  }
}

interface ResourceInventoryCollectionTaskEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeDB: D1Database;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { ResourceInventoryCollectionTask };
