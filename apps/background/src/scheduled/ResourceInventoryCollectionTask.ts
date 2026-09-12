import { DataCollectionConfigDAO, ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { ArnUtil } from '@aws-access-bridge/backend-services/aws/ArnUtil';
import { CollectorRegistry, type ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws/collectors';
import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { AccessKeys, ResourceInventoryItem } from '@aws-access-bridge/shared/model';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';

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
    const intervalHours: number = ConfigurationManager.resource.getCollectionIntervalHours(env);
    const cutoffTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - intervalHours * 3600;
    const dataCollectionConfigDAO: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    const principalArns: string[] = await dataCollectionConfigDAO.getPrincipalArnsNeedingCollection(
      'resource',
      MAX_ACCOUNTS_PER_COLLECTION,
      cutoffTime,
    );

    if (principalArns.length === 0) return { itemsProcessed: 0, itemsFailed: 0, summary: 'No accounts due for collection' };

    const credentialService = CredentialServiceFactory.create(env);
    const collectors = CollectorRegistry.getAll();
    const resourceDAO: ResourceInventoryDAO = new ResourceInventoryDAO(env.AccessBridgeDB);

    let collectedCount: number = 0;
    let failedCount: number = 0;
    for (const principalArn of principalArns) {
      try {
        const { credentials }: { credentials: AccessKeys } = await credentialService.resolveLeafCredentials(
          principalArn,
          'AccessBridge-ResourceCollection',
        );

        const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
        const collectedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();

        // Collect from every registered collector; one provider failing must not fail the account.
        const allItems: ResourceDiscoveryItem[] = [];
        for (const collector of collectors.values()) {
          try {
            allItems.push(...(await collector.collect(credentials)));
          } catch (e) {
            console.warn(`${collector.resourceType} collection failed:`, e);
          }
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
        for (const resourceType of collectors.keys()) {
          await resourceDAO.deleteStaleResources(accountId, resourceType, collectedAt);
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
  RESOURCE_COLLECTION_INTERVAL_HOURS?: string;
  AccessBridgeDB: D1Database;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  AccessBridgeKV: KVNamespace;
}

export { ResourceInventoryCollectionTask };
