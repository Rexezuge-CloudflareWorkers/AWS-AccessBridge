import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { awsQueryRequest, parseXmlTag } from '@aws-access-bridge/provider-clients/aws';
import { matchAll } from '@aws-access-bridge/shared/utils';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

const API_VERSION = '2014-10-31';

class RdsCollector extends BaseAwsCollector {
  public override readonly resourceType = 'rds';

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    // RDS pages at 100 instances via the Query-protocol `Marker`. Following it is
    // what keeps a large database fleet from being pruned and re-added 100 rows at
    // a time.
    const pages: string[] = await this.paginate<string>(
      async (token) => {
        const params = new URLSearchParams({ Action: 'DescribeDBInstances', Version: API_VERSION });
        if (token) {
          params.set('Marker', token);
        }
        const request: { url: string; init: RequestInit } = awsQueryRequest(`https://rds.${region}.amazonaws.com/`, params);
        const xmlText: string = await this.fetchText(request.url, 'rds', region, accessKeys, request.init);
        return { page: xmlText, nextToken: parseXmlTag(xmlText, 'Marker') };
      },
      (page: string): string | undefined => parseXmlTag(page, 'Marker'),
      'rds',
      region,
    );

    return pages.flatMap((xmlText: string) => {
      const ids: string[] = matchAll(xmlText, /<DBInstanceIdentifier>([^<]+)<\/DBInstanceIdentifier>/g);
      const statuses: string[] = matchAll(xmlText, /<DBInstanceStatus>([^<]+)<\/DBInstanceStatus>/g);
      const engines: string[] = matchAll(xmlText, /<Engine>([^<]+)<\/Engine>/g);

      return ids.map((id, index) => ({
        resourceType: 'rds',
        resourceId: id,
        resourceName: id,
        state: statuses[index] || 'unknown',
        region,
        metadata: { engine: engines[index] || '' },
      }));
    });
  }
}

export { RdsCollector };