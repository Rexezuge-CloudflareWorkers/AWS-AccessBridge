import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

interface DynamoDbListTablesResponse {
  TableNames?: string[];
}

class DynamoDbCollector extends BaseAwsCollector {
  public override readonly resourceType = 'dynamodb';

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    // DynamoDB's JSON protocol requires POST plus a target header; it has no GET
    // discovery endpoint.
    const data: DynamoDbListTablesResponse = await this.fetchJsonWithInit<DynamoDbListTablesResponse>(
      `https://dynamodb.${region}.amazonaws.com/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'DynamoDB_20120810.ListTables',
        },
        body: JSON.stringify({}),
      },
      'dynamodb',
      region,
      accessKeys,
    );

    return (data.TableNames ?? []).map((tableName) => ({
      resourceType: 'dynamodb',
      resourceId: `${region}:${tableName}`,
      resourceName: tableName,
      state: 'active',
      region,
      metadata: {},
    }));
  }
}

export { DynamoDbCollector };