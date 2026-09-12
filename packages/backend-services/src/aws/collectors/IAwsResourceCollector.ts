import type { AccessKeys } from '@aws-access-bridge/shared/model';

interface ResourceDiscoveryItem {
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  region: string;
  metadata: Record<string, string>;
}

interface IAwsResourceCollector {
  readonly resourceType: string;
  collect(accessKeys: AccessKeys, region?: string): Promise<ResourceDiscoveryItem[]>;
}

export type { IAwsResourceCollector, ResourceDiscoveryItem };
