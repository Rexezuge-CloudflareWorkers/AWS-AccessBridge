import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CollectorRegistry, type ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws/collectors';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import type { AccessKeys, ResourceInventoryItem } from '@aws-access-bridge/shared/model';
import { AbstractCollectionTask } from './AbstractCollectionTask';
import type { CollectionTaskEnv } from './AbstractCollectionTask';

const MAX_ACCOUNTS_PER_COLLECTION: number = 2;

class ResourceInventoryCollectionTask extends AbstractCollectionTask<ResourceInventoryCollectionTaskEnv> {
  protected override getTaskType(): string {
    return 'resource-inventory-collection';
  }

  protected collectionType(): 'resource' {
    return 'resource';
  }

  protected maxAccountsPerCollection(): number {
    return MAX_ACCOUNTS_PER_COLLECTION;
  }

  protected collectionIntervalHours(env: ResourceInventoryCollectionTaskEnv): number {
    return ConfigurationManager.resource.getCollectionIntervalHours(env);
  }

  protected sessionName(): string {
    return 'AccessBridge-ResourceCollection';
  }

  protected override async collectForAccount(
    principalArn: string,
    credentials: AccessKeys,
    accountId: string,
    env: ResourceInventoryCollectionTaskEnv,
  ): Promise<number> {
    const collectors = CollectorRegistry.getAll();
    const resourceDAO = new ResourceInventoryDAO(env.AccessBridgeDB);
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

    console.log(`Resource inventory collected for ${principalArn}: ${allItems.length} resources`);
    return allItems.length;
  }
}

interface ResourceInventoryCollectionTaskEnv extends CollectionTaskEnv {
  RESOURCE_COLLECTION_INTERVAL_HOURS?: string;
}

export { ResourceInventoryCollectionTask };
