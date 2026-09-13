import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

interface LambdaListResponse {
  Functions?: Array<{
    FunctionArn?: string;
    FunctionName?: string;
    State?: string;
    Runtime?: string;
    MemorySize?: number;
  }>;
}

class LambdaCollector extends BaseAwsCollector {
  public override readonly resourceType = 'lambda';

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    super(clientFactory);
  }

  public async listFunctions(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 'lambda', region, keys: accessKeys });

    const response: Response = await client.fetch(`https://lambda.${region}.amazonaws.com/2015-03-31/functions`);

    if (!response.ok) {
      console.error(`Lambda ListFunctions failed: ${response.status}`);
      return [];
    }

    const data: LambdaListResponse = (await response.json());
    const items: ResourceDiscoveryItem[] = [];
    const functions = data.Functions ?? [];

    for (const fn of functions) {
      const resourceId: string = fn.FunctionArn ?? fn.FunctionName ?? 'unknown';
      const resourceName: string = fn.FunctionName ?? resourceId;
      items.push({
        resourceType: 'lambda',
        resourceId,
        resourceName,
        state: fn.State ?? 'Active',
        region,
        metadata: { runtime: fn.Runtime ?? '', memorySize: String(fn.MemorySize ?? '') },
      });
    }

    return items;
  }
}

export { LambdaCollector };
