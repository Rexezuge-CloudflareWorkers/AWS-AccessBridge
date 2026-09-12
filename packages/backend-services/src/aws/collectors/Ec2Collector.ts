import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

class Ec2Collector implements IAwsResourceCollector {
  public readonly resourceType = 'ec2';
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async describeInstances(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  public async collect(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 'ec2', region, keys: accessKeys });

    const params: URLSearchParams = new URLSearchParams({ Action: 'DescribeInstances', Version: '2016-11-15' });
    const response: Response = await client.fetch(`https://ec2.${region}.amazonaws.com/?${params.toString()}`);
    const xmlText: string = await response.text();

    if (!response.ok) {
      console.error(`EC2 DescribeInstances failed: ${response.status}`);
      return [];
    }

    const items: ResourceDiscoveryItem[] = [];
    const instanceRegex = /<instanceId>([^<]+)<\/instanceId>/g;
    const stateRegex = /<name>([^<]+)<\/name>/g;
    const nameTagRegex = /<key>Name<\/key>\s*<value>([^<]*)<\/value>/g;

    let match: RegExpExecArray | null;
    const instanceIds: string[] = [];
    while ((match = instanceRegex.exec(xmlText)) !== null) instanceIds.push(match[1]);

    const states: string[] = [];
    while ((match = stateRegex.exec(xmlText)) !== null) states.push(match[1]);

    const names: string[] = [];
    while ((match = nameTagRegex.exec(xmlText)) !== null) names.push(match[1]);

    for (const [i, instanceId] of instanceIds.entries()) {
      items.push({
        resourceType: 'ec2',
        resourceId: instanceId,
        resourceName: names[i] || instanceId,
        state: states[i] || 'unknown',
        region,
        metadata: {},
      });
    }

    return items;
  }
}

export { Ec2Collector };
