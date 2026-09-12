import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

class LambdaCollector implements IAwsResourceCollector {
  public readonly resourceType = 'lambda';
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async listFunctions(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  public async collect(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 'lambda', region, keys: accessKeys });

    const response: Response = await client.fetch(`https://lambda.${region}.amazonaws.com/2015-03-31/functions`);

    if (!response.ok) {
      console.error(`Lambda ListFunctions failed: ${response.status}`);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const items: ResourceDiscoveryItem[] = [];
    const functions = data.Functions || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const fn of functions as any[]) {
      items.push({
        resourceType: 'lambda',
        resourceId: fn.FunctionArn || fn.FunctionName,
        resourceName: fn.FunctionName,
        state: fn.State || 'Active',
        region,
        metadata: { runtime: fn.Runtime || '', memorySize: String(fn.MemorySize || '') },
      });
    }

    return items;
  }
}

export { LambdaCollector };
