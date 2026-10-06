import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { createRequestScope, Tokens } from '@aws-access-bridge/backend-services/composition';
import type { ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws/collectors';
import { log, TimestampUtil } from '@aws-access-bridge/shared/utils';
import { RESOURCE_COLLECTION_ROLE_SESSION_NAME } from '@aws-access-bridge/shared/constants';
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
    return RESOURCE_COLLECTION_ROLE_SESSION_NAME;
  }

  protected override async collectForAccount(
    principalArn: string,
    credentials: AccessKeys,
    accountId: string,
    env: ResourceInventoryCollectionTaskEnv,
  ): Promise<number> {
    // A fresh scope per run, not the cached one: a Durable Object's `env` is stable
    // for the object's lifetime, so a cached scope would pin the memoized
    // encryption keys after a rotation. Same rule as `AbstractCollectionTask`.
    const registry = createRequestScope(env).get(Tokens.CollectorRegistry);
    const collectors = registry.getAll();
    const regions = ConfigurationManager.resource.getInventoryRegions(env);
    const resourceDAO = new ResourceInventoryDAO(env.AccessBridgeDB);
    const collectedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();

    // Sweep every collector across every configured region. Two rules govern what
    // may be pruned, and both are about not destroying data we did not read:
    //
    // 1. A provider failing must not fail the account.
    // 2. A type joins `collectedTypes` only when *every* configured region it was
    //    asked to read succeeded — not merely that one region worked. `collectAllRegions`
    //    reports per-region failures, so a role denied in `eu-west-1` leaves that
    //    type's rows untouched rather than pruning them to the other 26 regions.
    //
    // `BaseAwsCollector` throws on a non-OK response precisely so "denied" cannot
    // be mistaken for "empty": an empty-but-successful region is a real answer and
    // counts as read.
    const allItems: ResourceDiscoveryItem[] = [];
    const collectedTypes = new Set<string>();
    const incompleteTypes: string[] = [];

    for (const collector of collectors.values()) {
      const expectedRegionCount: number = collector.isRegional ? regions.length : 1;
      try {
        const sweep = await collector.collectAllRegions(credentials, regions);
        allItems.push(...sweep.items);

        if (sweep.succeededRegions.length === expectedRegionCount && sweep.failedRegions.length === 0) {
          collectedTypes.add(collector.resourceType);
        } else {
          incompleteTypes.push(collector.resourceType);
          log.warn(`${collector.resourceType} collection incomplete for ${principalArn}: ${sweep.succeededRegions.length}/${expectedRegionCount} region(s) read; ` +
              `leaving its previously recorded resources untouched. Failures: ${sweep.failedRegions.map((failure) => `${failure.region} (${failure.reason})`).join('; ')}`);
        }
      } catch (error: unknown) {
        incompleteTypes.push(collector.resourceType);
        log.warn(`${collector.resourceType} collection failed; its previously recorded resources are left untouched:`, { error: error });
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

    // Prune stale rows only for the types we read in full this run.
    for (const resourceType of collectedTypes) {
      await resourceDAO.deleteStaleResources(accountId, resourceType, collectedAt);
    }

    log.info(`Resource inventory collected for ${principalArn}: ${allItems.length} resources across ${collectedTypes.size}/${collectors.size} type(s) ` +
        `over ${regions.length} configured region(s)` +
        (incompleteTypes.length > 0 ? `; incomplete: ${incompleteTypes.join(', ')}` : ''));
    return allItems.length;
  }
}

interface ResourceInventoryCollectionTaskEnv extends CollectionTaskEnv {
  RESOURCE_COLLECTION_INTERVAL_HOURS?: string;
}

export { ResourceInventoryCollectionTask };
