import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

class S3Collector implements IAwsResourceCollector {
  public readonly resourceType = 's3';
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async listBuckets(accessKeys: AccessKeys): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys);
  }

  public async collect(accessKeys: AccessKeys): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 's3', region: 'us-east-1', keys: accessKeys });

    const response: Response = await client.fetch('https://s3.amazonaws.com/');
    const xmlText: string = await response.text();

    if (!response.ok) {
      console.error(`S3 ListBuckets failed: ${response.status}`);
      return [];
    }

    const items: ResourceDiscoveryItem[] = [];
    const nameRegex = /<Name>([^<]+)<\/Name>/g;
    let match: RegExpExecArray | null;
    while ((match = nameRegex.exec(xmlText)) !== null) {
      items.push({
        resourceType: 's3',
        resourceId: match[1],
        resourceName: match[1],
        state: 'active',
        region: 'global',
        metadata: {},
      });
    }

    return items;
  }
}

export { S3Collector };
