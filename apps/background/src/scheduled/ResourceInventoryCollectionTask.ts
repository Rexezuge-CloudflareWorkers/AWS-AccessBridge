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

    // Collect from every registered collector. One provider failing must not fail
    // the account — but it must also not cost the account its previously
    // collected resources of that type, so a type only joins `collectedTypes`
    // when its collector actually returned. `BaseAwsCollector` throws rather than
    // resolving to `[]` on a non-OK response precisely so that "denied" cannot be
    // mistaken for "empty" here: an empty-but-successful call is a real answer
    // and prunes, a failed one is unknown and must not.
    const allItems: ResourceDiscoveryItem[] = [];
    const collectedTypes = new Set<string>();
    for (const collector of collectors.values()) {
      try {
        const items: ResourceDiscoveryItem[] = await collector.collect(credentials);
        allItems.push(...items);
        collectedTypes.add(collector.resourceType);
      } catch (error: unknown) {
        console.warn(`${collector.resourceType} collection failed; its previously recorded resources are left untouched:`, error);
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

    // Prune stale rows only for the types we successfully read this run.
    for (const resourceType of collectedTypes) {
      await resourceDAO.deleteStaleResources(accountId, resourceType, collectedAt);
    }

    console.log(`Resource inventory collected for ${principalArn}: ${allItems.length} resources across ${collectedTypes.size}/${collectors.size} type(s)`);
    return allItems.length;
  }
}

interface ResourceInventoryCollectionTaskEnv extends CollectionTaskEnv {
  RESOURCE_COLLECTION_INTERVAL_HOURS?: string;
}

export { ResourceInventoryCollectionTask };
