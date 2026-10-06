import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { parseXmlTag } from '@aws-access-bridge/provider-clients/aws';
import { matchAll } from '@aws-access-bridge/shared/utils';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class S3Collector extends BaseAwsCollector {
  public override readonly resourceType = 's3';
  /**
   * Buckets are global: `ListBuckets` is answered by one endpoint regardless of
   * region, so sweeping the configured list would issue N identical requests per
   * account. Swept once and recorded under `global`.
   */
  public override readonly isRegional = false;

  protected override async collectWithRegion(accessKeys: AccessKeys, _region: string): Promise<ResourceDiscoveryItem[]> {
    // S3 is a global service: the request goes to the global endpoint and
    // discovered buckets are reported with region 'global'.
    //
    // `list-type=2` is required for the V2 continuation protocol, which pages at
    // 1000 buckets via `NextContinuationToken`. The V1 listing (the default when
    // `list-type` is absent) cannot be paginated at all, which is why it was
    // previously stuck at one un-paginatable page — an account with more than
    // 1000 buckets had the remainder pruned on every collection run.
    const pages: string[] = await this.paginate<string>(
      async (token) => {
        const query = new URLSearchParams({ 'list-type': '2' });
        if (token) {
          query.set('continuation-token', token);
        }
        const xmlText: string = await this.fetchText(
          `https://s3.amazonaws.com/?${query.toString()}`,
          's3',
          'us-east-1',
          accessKeys,
        );
        return { page: xmlText, nextToken: parseXmlTag(xmlText, 'NextContinuationToken') };
      },
      (page: string): string | undefined => parseXmlTag(page, 'NextContinuationToken'),
      's3',
      'us-east-1',
    );

    return pages.flatMap((xmlText: string) =>
      matchAll(xmlText, /<Name>([^<]+)<\/Name>/g).map((bucketName) => ({
        resourceType: 's3',
        resourceId: bucketName,
        resourceName: bucketName,
        state: 'active',
        region: 'global',
        metadata: {},
      })),
    );
  }
}

export { S3Collector };