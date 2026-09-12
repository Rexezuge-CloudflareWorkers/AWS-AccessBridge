import { AwsClient } from 'aws4fetch';
import { AccessKeys } from '@aws-access-bridge/shared/model';
import { BadRequestError, InternalServerError } from '@aws-access-bridge/backend-errors';

interface CostExplorerResult {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  currency: string;
  serviceBreakdown: Record<string, number>;
}

class AwsApiUtil {
  public static async getCostAndUsage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'DAILY',
    region: string = 'us-east-1',
  ): Promise<CostExplorerResult[]> {
    const client: AwsClient = new AwsClient({
      service: 'ce',
      region: region,
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

    const body = JSON.stringify({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: granularity,
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    const response: Response = await client.fetch(`https://ce.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSInsightsIndexService.GetCostAndUsage',
      },
      body,
    });

    const responseText: string = await response.text();

    if (!response.ok) {
      console.error(`Cost Explorer API failed: ${response.status}\n${responseText}`);
      throw new InternalServerError(`Cost Explorer API failed: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = JSON.parse(responseText);
    const results: CostExplorerResult[] = [];
    const resultsByTime: any[] = data.ResultsByTime || [];

    for (const result of resultsByTime) {
      const serviceBreakdown: Record<string, number> = {};
      let totalCost: number = 0;
      let currency: string = 'USD';
      const groups: any[] = result.Groups || [];

      for (const group of groups) {
        const serviceName: string = group.Keys?.[0] || 'Unknown';
        const amount: number = Number(group.Metrics?.UnblendedCost?.Amount || '0');
        currency = group.Metrics?.UnblendedCost?.Unit || 'USD';
        if (amount > 0) {
          serviceBreakdown[serviceName] = amount;
          totalCost += amount;
        }
      }

      results.push({
        accountId: '',
        periodStart: result.TimePeriod?.Start || startDate,
        periodEnd: result.TimePeriod?.End || endDate,
        totalCost: Math.round(totalCost * 100) / 100,
        currency,
        serviceBreakdown,
      });
    }

    return results;
  }

  public static async describeInstances(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client: AwsClient = new AwsClient({
      service: 'ec2',
      region,
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

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

  public static async listBuckets(accessKeys: AccessKeys): Promise<ResourceDiscoveryItem[]> {
    const client: AwsClient = new AwsClient({
      service: 's3',
      region: 'us-east-1',
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

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

  public static async listFunctions(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client: AwsClient = new AwsClient({
      service: 'lambda',
      region,
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

    const response: Response = await client.fetch(`https://lambda.${region}.amazonaws.com/2015-03-31/functions`);

    if (!response.ok) {
      console.error(`Lambda ListFunctions failed: ${response.status}`);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const items: ResourceDiscoveryItem[] = [];
    const functions = data.Functions || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const fn of functions as any[]) {
      items.push({
        resourceType: 'lambda',
        resourceId: fn.FunctionArn || fn.FunctionName,
        resourceName: fn.FunctionName,
        state: fn.State || 'Active',
        region,
        metadata: { runtime: fn.Runtime || '', memorySize: String(fn.MemorySize || '') },
      });
    }

    return items;
  }

  public static async listTables(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client: AwsClient = new AwsClient({
      service: 'dynamodb',
      region,
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

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

  public static async describeDBInstances(accessKeys: AccessKeys, region: string = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    const client: AwsClient = new AwsClient({
      service: 'rds',
      region,
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

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

  public static async validateCredentials(
    accessKeyId: string,
    secretAccessKey: string,
    sessionToken?: string,
  ): Promise<{ arn: string; accountId: string; userId: string }> {
    const stsClient: AwsClient = new AwsClient({
      service: 'sts',
      region: 'us-east-1',
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
    });

    const url: string = `https://sts.us-east-1.amazonaws.com/?${queryParams.toString()}`;
    const response: Response = await stsClient.fetch(url, { method: 'POST' });
    const xmlText: string = await response.text();

    if (!response.ok) {
      throw new BadRequestError(`AWS credentials are invalid: ${response.status} ${response.statusText}`);
    }

    const arnMatch: RegExpMatchArray | null = /<Arn>([^<]+)<\/Arn>/.exec(xmlText);
    const accountMatch: RegExpMatchArray | null = /<Account>([^<]+)<\/Account>/.exec(xmlText);
    const userIdMatch: RegExpMatchArray | null = /<UserId>([^<]+)<\/UserId>/.exec(xmlText);

    if (!arnMatch || !accountMatch || !userIdMatch) {
      throw new InternalServerError('Failed to parse STS GetCallerIdentity response.');
    }

    return {
      arn: arnMatch[1],
      accountId: accountMatch[1],
      userId: userIdMatch[1],
    };
  }

  public static async listRoles(accessKeys: AccessKeys): Promise<Array<{ roleName: string; arn: string; description: string }>> {
    const iamClient: AwsClient = new AwsClient({
      service: 'iam',
      region: 'us-east-1',
      accessKeyId: accessKeys.accessKeyId,
      secretAccessKey: accessKeys.secretAccessKey,
      sessionToken: accessKeys.sessionToken,
    });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'ListRoles',
      Version: '2010-05-08',
      MaxItems: '100',
    });

    const url: string = `https://iam.amazonaws.com/?${queryParams.toString()}`;
    const response: Response = await iamClient.fetch(url, { method: 'GET' });
    const xmlText: string = await response.text();

    if (!response.ok) {
      if (xmlText.includes('AccessDenied') || xmlText.includes('not authorized')) {
        throw new BadRequestError('The assumed role does not have iam:ListRoles permission. You can still manually enter role names.');
      }
      throw new InternalServerError(`IAM ListRoles failed: ${response.status}`);
    }

    const roles: Array<{ roleName: string; arn: string; description: string }> = [];
    const memberRegex = /<member>([\s\S]*?)<\/member>/g;
    let memberMatch: RegExpExecArray | null;
    while ((memberMatch = memberRegex.exec(xmlText)) !== null) {
      const member: string = memberMatch[1];
      const roleNameMatch: RegExpMatchArray | null = /<RoleName>([^<]+)<\/RoleName>/.exec(member);
      const arnMatch: RegExpMatchArray | null = /<Arn>([^<]+)<\/Arn>/.exec(member);
      const descMatch: RegExpMatchArray | null = /<Description>([^<]*)<\/Description>/.exec(member);

      if (roleNameMatch && arnMatch) {
        roles.push({
          roleName: roleNameMatch[1],
          arn: arnMatch[1],
          description: descMatch ? descMatch[1] : '',
        });
      }
    }

    return roles;
  }
}

interface ResourceDiscoveryItem {
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  region: string;
  metadata: Record<string, string>;
}

export { AwsApiUtil };
export type { CostExplorerResult, ResourceDiscoveryItem };
