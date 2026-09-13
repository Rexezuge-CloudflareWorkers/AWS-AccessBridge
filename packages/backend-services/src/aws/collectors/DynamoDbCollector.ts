import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

class DynamoDbCollector extends BaseAwsCollector {
  public override readonly resourceType = 'dynamodb';

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    super(clientFactory);
  }

  public async listTables(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    const client = this.clientFactory({ service: 'dynamodb', region, keys: accessKeys });

    const response: Response = await client.fetch(`https://dynamodb.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'DynamoDB_20120810.ListTables',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      console.error(`DynamoDB ListTables failed: ${response.status}`);
      return [];
    }

    const data: { TableNames?: string[] } = (await response.json());
    const items: ResourceDiscoveryItem[] = [];
    const tableNames: string[] = data.TableNames ?? [];

    for (const tableName of tableNames) {
      items.push({
        resourceType: 'dynamodb',
        resourceId: `${region}:${tableName}`,
        resourceName: tableName,
        state: 'active',
        region,
        metadata: {},
      });
    }

    return items;
  }
}

export { DynamoDbCollector };
