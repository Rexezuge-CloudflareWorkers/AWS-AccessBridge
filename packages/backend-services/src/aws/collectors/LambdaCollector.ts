import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

const API_DATE = '2015-03-31';

interface LambdaListResponse {
  Functions?: Array<{
    FunctionArn?: string;
    FunctionName?: string;
    State?: string;
    Runtime?: string;
    MemorySize?: number;
  }>;
  /**
   * Continuation cursor, returned only when more results remain.
   */
  NextMarker?: string;
}

class LambdaCollector extends BaseAwsCollector {
  public override readonly resourceType = 'lambda';
  public override readonly isRegional = true;

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    // Lambda pages via the `Marker` query parameter, echoed back as `NextMarker`.
    // A single page is at most 1000 functions, so an account above that was
    // silently recorded as smaller than it is — and pruned back on every run.
    const pages: LambdaListResponse[] = await this.paginate<LambdaListResponse>(
      async (token) => {
        const query: string = token ? `?Marker=${encodeURIComponent(token)}` : '';
        const page: LambdaListResponse = await this.fetchJson<LambdaListResponse>(
          `https://lambda.${region}.amazonaws.com/${API_DATE}/functions${query}`,
          { accessKeys, region, service: 'lambda' },
        );
        return { page, nextToken: page.NextMarker };
      },
      (page: LambdaListResponse): string | undefined => page.NextMarker,
      'lambda',
      region,
    );

    return pages.flatMap((data: LambdaListResponse) =>
      (data.Functions ?? []).map((fn) => {
        const resourceId: string = fn.FunctionArn ?? fn.FunctionName ?? 'unknown';
        return {
          resourceType: 'lambda',
          resourceId,
          resourceName: fn.FunctionName ?? resourceId,
          state: fn.State ?? 'Active',
          region,
          metadata: { runtime: fn.Runtime ?? '', memorySize: String(fn.MemorySize ?? '') },
        };
      }),
    );
  }
}

export { LambdaCollector };
