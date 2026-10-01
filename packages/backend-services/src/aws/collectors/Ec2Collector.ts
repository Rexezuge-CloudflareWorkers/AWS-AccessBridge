import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { matchAll } from '@aws-access-bridge/shared/utils';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class Ec2Collector extends BaseAwsCollector {
  public override readonly resourceType = 'ec2';

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const params: URLSearchParams = new URLSearchParams({ Action: 'DescribeInstances', Version: '2016-11-15' });
    const xmlText: string = await this.fetchText(`https://ec2.${region}.amazonaws.com/?${params.toString()}`, 'ec2', region, accessKeys);

    const instanceIds: string[] = matchAll(xmlText, /<instanceId>([^<]+)<\/instanceId>/g);
    const states: string[] = matchAll(xmlText, /<name>([^<]+)<\/name>/g);
    const names: string[] = matchAll(xmlText, /<key>Name<\/key>\s*<value>([^<]*)<\/value>/g);

    return instanceIds.map((instanceId, index) => ({
      resourceType: 'ec2',
      resourceId: instanceId,
      resourceName: names[index] || instanceId,
      state: states[index] || 'unknown',
      region,
      metadata: {},
    }));
  }
}

export { Ec2Collector };