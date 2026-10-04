import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { awsQueryRequest } from '@aws-access-bridge/provider-clients/aws';
import { matchAll } from '@aws-access-bridge/shared/utils';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class RdsCollector extends BaseAwsCollector {
  public override readonly resourceType = 'rds';

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const params: URLSearchParams = new URLSearchParams({ Action: 'DescribeDBInstances', Version: '2014-10-31' });
    const request: { url: string; init: RequestInit } = awsQueryRequest(`https://rds.${region}.amazonaws.com/`, params);
    const xmlText: string = await this.fetchText(request.url, 'rds', region, accessKeys, request.init);

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
  }
}

export { RdsCollector };
