import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { matchAll } from '@aws-access-bridge/shared/utils';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class RdsCollector extends BaseAwsCollector {
  public override readonly resourceType = 'rds';

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    super(clientFactory);
  }

  public async describeDBInstances(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const params: URLSearchParams = new URLSearchParams({ Action: 'DescribeDBInstances', Version: '2014-10-31' });
    const xmlText: string | undefined = await this.fetchText(`https://rds.${region}.amazonaws.com/?${params.toString()}`, 'rds', region, accessKeys);
    if (xmlText === undefined) {
      return [];
    }

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
