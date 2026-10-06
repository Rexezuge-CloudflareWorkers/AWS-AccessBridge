import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { awsQueryRequest, parseXmlTag } from '@aws-access-bridge/provider-clients/aws';
import { matchAll } from '@aws-access-bridge/shared/utils';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

const API_VERSION = '2016-11-15';

class Ec2Collector extends BaseAwsCollector {
  public override readonly resourceType = 'ec2';
  public override readonly isRegional = true;

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    // `DescribeInstances` returns at most 1000 instances per call, so the list is
    // followed to exhaustion. Reading one page and treating it as the account's
    // inventory let `ResourceInventoryCollectionTask` delete the unreturned
    // remainder on every subsequent run.
    const pages: string[] = await this.paginate<string>(
      async (token) => {
        const params = new URLSearchParams({ Action: 'DescribeInstances', Version: API_VERSION });
        if (token) {
          params.set('NextToken', token);
        }
        const request: { url: string; init: RequestInit } = awsQueryRequest(`https://ec2.${region}.amazonaws.com/`, params);
        const xmlText: string = await this.fetchText(request.url, 'ec2', region, accessKeys, request.init);
        return { page: xmlText, nextToken: parseXmlTag(xmlText, 'nextToken') };
      },
      // The page *is* the XML, so the token is already on it.
      (page: string): string | undefined => parseXmlTag(page, 'nextToken'),
      'ec2',
      region,
    );

    return pages.flatMap((xmlText: string) => {
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
    });
  }
}

export { Ec2Collector };