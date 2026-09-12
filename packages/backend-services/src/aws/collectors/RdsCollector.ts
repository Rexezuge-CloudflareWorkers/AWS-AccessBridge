import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

class RdsCollector implements IAwsResourceCollector {
  public readonly resourceType = 'rds';
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async describeDBInstances(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  public async collect(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 'rds', region, keys: accessKeys });

    const params: URLSearchParams = new URLSearchParams({ Action: 'DescribeDBInstances', Version: '2014-10-31' });
    const response: Response = await client.fetch(`https://rds.${region}.amazonaws.com/?${params.toString()}`);
    const xmlText: string = await response.text();

    if (!response.ok) {
      console.error(`RDS DescribeDBInstances failed: ${response.status}`);
      return [];
    }

    const items: ResourceDiscoveryItem[] = [];
    const idRegex = /<DBInstanceIdentifier>([^<]+)<\/DBInstanceIdentifier>/g;
    const statusRegex = /<DBInstanceStatus>([^<]+)<\/DBInstanceStatus>/g;
    const engineRegex = /<Engine>([^<]+)<\/Engine>/g;

    const ids: string[] = [];
    const statuses: string[] = [];
    const engines: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = idRegex.exec(xmlText)) !== null) ids.push(match[1]);
    while ((match = statusRegex.exec(xmlText)) !== null) statuses.push(match[1]);
    while ((match = engineRegex.exec(xmlText)) !== null) engines.push(match[1]);

    for (const [i, id] of ids.entries()) {
      items.push({
        resourceType: 'rds',
        resourceId: id,
        resourceName: id,
        state: statuses[i] || 'unknown',
        region,
        metadata: { engine: engines[i] || '' },
      });
    }

    return items;
  }
}

export { RdsCollector };
