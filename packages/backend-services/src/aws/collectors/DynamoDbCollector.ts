import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { BaseAwsCollector } from './BaseAwsCollector';
import type { ResourceDiscoveryItem } from './IAwsResourceCollector';

interface DynamoDbListTablesResponse {
  TableNames?: string[];
  /**
   * Resume cursor. Present only while more tables remain.
   */
  LastEvaluatedTableName?: string;
}

class DynamoDbCollector extends BaseAwsCollector {
  public override readonly resourceType = 'dynamodb';

  protected override async collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]> {
    // DynamoDB pages at 100 tables and resumes with `ExclusiveStartTableName` in
    // the *body* (its JSON protocol has no query-string parameters), echoed back
    // as `LastEvaluatedTableName`.
    const pages: DynamoDbListTablesResponse[] = await this.paginate<DynamoDbListTablesResponse>(
      async (token) => {
        const page: DynamoDbListTablesResponse = await this.fetchJsonWithInit<DynamoDbListTablesResponse>(
          `https://dynamodb.${region}.amazonaws.com/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': 'DynamoDB_20120810.ListTables',
            },
            body: JSON.stringify(token ? { ExclusiveStartTableName: token } : {}),
          },
          'dynamodb',
          region,
          accessKeys,
        );
        return { page, nextToken: page.LastEvaluatedTableName };
      },
      (page: DynamoDbListTablesResponse): string | undefined => page.LastEvaluatedTableName,
      'dynamodb',
      region,
    );

    return pages.flatMap((data: DynamoDbListTablesResponse) =>
      (data.TableNames ?? []).map((tableName) => ({
        resourceType: 'dynamodb',
        resourceId: `${region}:${tableName}`,
        resourceName: tableName,
        state: 'active',
        region,
        metadata: {},
      })),
    );
  }
}

export { DynamoDbCollector };