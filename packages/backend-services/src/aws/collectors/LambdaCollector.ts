import type { AccessKeys } from '@aws-access-bridge/shared/model';
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

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const data: LambdaListResponse = await this.fetchJson<LambdaListResponse>(
      `https://lambda.${region}.amazonaws.com/2015-03-31/functions`,
      'lambda',
      region,
      accessKeys,
    );

    return (data.Functions ?? []).map((fn) => {
      const resourceId: string = fn.FunctionArn ?? fn.FunctionName ?? 'unknown';
      return {
        resourceType: 'lambda',
        resourceId,
        resourceName: fn.FunctionName ?? resourceId,
        state: fn.State ?? 'Active',
        region,
        metadata: { runtime: fn.Runtime ?? '', memorySize: String(fn.MemorySize ?? '') },
      };
    });
  }
}

export { LambdaCollector };