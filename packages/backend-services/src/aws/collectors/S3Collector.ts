import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { matchAll } from '@aws-access-bridge/shared/utils';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class S3Collector extends BaseAwsCollector {
  public override readonly resourceType = 's3';

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    super(clientFactory);
  }

  public async listBuckets(accessKeys: AccessKeys): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys);
  }

  protected override async collectWithRegion(accessKeys: AccessKeys, _region: string): Promise<ResourceDiscoveryItem[]> {
    // S3 is a global service: the request goes to the global endpoint and
    // discovered buckets are reported with region 'global'.
    const xmlText: string | undefined = await this.fetchText('https://s3.amazonaws.com/', 's3', 'us-east-1', accessKeys);
    if (xmlText === undefined) {
      return [];
    }
    return matchAll(xmlText, /<Name>([^<]+)<\/Name>/g).map((bucketName) => ({
      resourceType: 's3',
      resourceId: bucketName,
      resourceName: bucketName,
      state: 'active',
      region: 'global',
      metadata: {},
    }));
  }
}

export { S3Collector };
