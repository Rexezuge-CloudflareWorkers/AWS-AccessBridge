import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

class DynamoDbCollector implements IAwsResourceCollector {
  public readonly resourceType = 'dynamodb';
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async listTables(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collect(accessKeys, region);
  }

  public async collect(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const items: ResourceDiscoveryItem[] = [];
    const tableNames = data.TableNames || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tableName of tableNames as any[]) {
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
