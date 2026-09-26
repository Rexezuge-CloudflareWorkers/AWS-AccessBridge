import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ec2Collector } from '@aws-access-bridge/backend-services/aws/collectors/Ec2Collector';
import { S3Collector } from '@aws-access-bridge/backend-services/aws/collectors/S3Collector';
import { LambdaCollector } from '@aws-access-bridge/backend-services/aws/collectors/LambdaCollector';
import { RdsCollector } from '@aws-access-bridge/backend-services/aws/collectors/RdsCollector';
import { DynamoDbCollector } from '@aws-access-bridge/backend-services/aws/collectors/DynamoDbCollector';
import { matchAll } from '@aws-access-bridge/shared/utils';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

const KEYS: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' };

function factoryReturning(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  const clientFactory = vi.fn().mockReturnValue({ fetch });
  return { clientFactory, fetch };
}

function ok(body: string, contentType = 'application/json'): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
}

describe('matchAll', () => {
  it('returns every capture group in document order', () => {
    expect(matchAll('<a>1</a><a>2</a>', /<a>([^<]+)<\/a>/g)).toEqual(['1', '2']);
  });

  it('returns an empty array when there are no matches', () => {
    expect(matchAll('nothing here', /<a>([^<]+)<\/a>/g)).toEqual([]);
  });

  it('yields an empty string when the captured group did not participate', () => {
    // `b` matches the second alternative, so group 1 is undefined; callers get
    // '' rather than a hole in the array (the collectors index these positionally).
    expect(matchAll('b', /(a)|(b)/g)).toEqual(['']);
  });
});

describe('BaseAwsCollector error isolation', () => {
  // `fetchText`/`fetchJson` live on the base and are what make a denied or
  // throttled AWS call yield [] instead of throwing into the per-account loop
  // in ResourceInventoryCollectionTask.
  it('returns an empty list on a non-OK response rather than throwing', async () => {
    const { clientFactory, fetch } = factoryReturning(new Response('denied', { status: 403 }));
    const collector = new S3Collector(clientFactory as never);
    await expect(collector.listBuckets(KEYS)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith('https://s3.amazonaws.com/');
  });

  it('applies the same isolation to the JSON-protocol collectors', async () => {
    for (const [collector, url] of [
      [new LambdaCollector(factoryReturning(new Response('nope', { status: 403 })).clientFactory as never), 'https://lambda.eu-west-1.amazonaws.com/2015-03-31/functions'],
      [new RdsCollector(factoryReturning(new Response('nope', { status: 400 })).clientFactory as never), 'https://rds.eu-west-1.amazonaws.com/?Action=DescribeDBInstances&Version=2014-10-31'],
    ] as const) {
      await expect(collector.collect(KEYS, 'eu-west-1')).resolves.toEqual([]);
    }
  });
});

describe('S3Collector', () => {
  it('parses bucket names and reports them as global', async () => {
    const xml = '<ListAllMyBucketsResult><Buckets><Bucket><Name>alpha</Name></Bucket><Bucket><Name>beta</Name></Bucket></Buckets></ListAllMyBucketsResult>';
    const { clientFactory } = factoryReturning(ok(xml, 'application/xml'));
    const items = await new S3Collector(clientFactory as never).listBuckets(KEYS);
    expect(items).toEqual([
      { resourceType: 's3', resourceId: 'alpha', resourceName: 'alpha', state: 'active', region: 'global', metadata: {} },
      { resourceType: 's3', resourceId: 'beta', resourceName: 'beta', state: 'active', region: 'global', metadata: {} },
    ]);
  });

  it('returns an empty list when the account has no buckets', async () => {
    const { clientFactory } = factoryReturning(ok('<ListAllMyBucketsResult></ListAllMyBucketsResult>', 'application/xml'));
    await expect(new S3Collector(clientFactory as never).listBuckets(KEYS)).resolves.toEqual([]);
  });
});

describe('Ec2Collector', () => {
  const xml = `
    <DescribeInstancesResponse>
      <reservationSet>
        <instancesSet>
          <item><instanceId>i-1</instanceId><name>running</name>
            <tagSet><item><key>Name</key><value>web-01</value></item></tagSet></item>
          <item><instanceId>i-2</instanceId><name>stopped</name>
            <tagSet><item><key>Env</key><value>prod</value></item></tagSet></item>
        </instancesSet>
      </reservationSet>
    </DescribeInstancesResponse>`;

  it('pairs instance ids with state and Name tag, falling back when absent', async () => {
    const { clientFactory, fetch } = factoryReturning(ok(xml, 'application/xml'));
    const items = await new Ec2Collector(clientFactory as never).describeInstances(KEYS, 'eu-west-1');
    expect(items).toEqual([
      { resourceType: 'ec2', resourceId: 'i-1', resourceName: 'web-01', state: 'running', region: 'eu-west-1', metadata: {} },
      // No Name tag, so the instance id is used.
      { resourceType: 'ec2', resourceId: 'i-2', resourceName: 'i-2', state: 'stopped', region: 'eu-west-1', metadata: {} },
    ]);
    expect(fetch).toHaveBeenCalledWith('https://ec2.eu-west-1.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15');
  });

  it('defaults to us-east-1 and reports unknown when the state is missing', async () => {
    const { clientFactory } = factoryReturning(ok('<item><instanceId>i-9</instanceId></item>', 'application/xml'));
    const items = await new Ec2Collector(clientFactory as never).collect(KEYS);
    expect(items).toEqual([{ resourceType: 'ec2', resourceId: 'i-9', resourceName: 'i-9', state: 'unknown', region: 'us-east-1', metadata: {} }]);
  });
});

describe('LambdaCollector', () => {
  it('maps function arn, name, state and size metadata', async () => {
    const { clientFactory, fetch } = factoryReturning(ok(JSON.stringify({ Functions: [{ FunctionArn: 'arn:aws:lambda:::function:a', FunctionName: 'a', State: 'Active', Runtime: 'nodejs20', MemorySize: 256 }] })));
    const items = await new LambdaCollector(clientFactory as never).listFunctions(KEYS, 'eu-west-1');
    expect(items).toEqual([
      {
        resourceType: 'lambda',
        resourceId: 'arn:aws:lambda:::function:a',
        resourceName: 'a',
        state: 'Active',
        region: 'eu-west-1',
        metadata: { runtime: 'nodejs20', memorySize: '256' },
      },
    ]);
    expect(fetch).toHaveBeenCalledWith('https://lambda.eu-west-1.amazonaws.com/2015-03-31/functions');
  });

  it('tolerates missing optional fields and an empty function list', async () => {
    const { clientFactory } = factoryReturning(ok(JSON.stringify({ Functions: [{ FunctionName: 'bare' }] })));
    await expect(new LambdaCollector(clientFactory as never).listFunctions(KEYS)).resolves.toEqual([
      { resourceType: 'lambda', resourceId: 'bare', resourceName: 'bare', state: 'Active', region: 'us-east-1', metadata: { runtime: '', memorySize: '' } },
    ]);

    const empty = factoryReturning(ok(JSON.stringify({})));
    await expect(new LambdaCollector(empty.clientFactory as never).listFunctions(KEYS)).resolves.toEqual([]);
  });
});

describe('RdsCollector', () => {
  it('maps instances with engine metadata', async () => {
    const xml = `
      <DescribeDBInstancesResponse>
        <DBInstances>
          <DBInstance><DBInstanceIdentifier>db-1</DBInstanceIdentifier><DBInstanceStatus>available</DBInstanceStatus><Engine>postgres</Engine></DBInstance>
          <DBInstance><DBInstanceIdentifier>db-2</DBInstanceIdentifier><DBInstanceStatus>stopped</DBInstanceStatus></DBInstance>
        </DBInstances>
      </DescribeDBInstancesResponse>`;
    const { clientFactory, fetch } = factoryReturning(ok(xml, 'application/xml'));
    const items = await new RdsCollector(clientFactory as never).describeDBInstances(KEYS, 'eu-west-1');
    expect(items).toEqual([
      { resourceType: 'rds', resourceId: 'db-1', resourceName: 'db-1', state: 'available', region: 'eu-west-1', metadata: { engine: 'postgres' } },
      { resourceType: 'rds', resourceId: 'db-2', resourceName: 'db-2', state: 'stopped', region: 'eu-west-1', metadata: { engine: '' } },
    ]);
    expect(fetch).toHaveBeenCalledWith('https://rds.eu-west-1.amazonaws.com/?Action=DescribeDBInstances&Version=2014-10-31');
  });
});

describe('DynamoDbCollector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('issues a ListTables POST and maps table names to region-scoped ids', async () => {
    const { clientFactory, fetch } = factoryReturning(ok(JSON.stringify({ TableNames: ['orders', 'events'] })));
    const items = await new DynamoDbCollector(clientFactory as never).listTables(KEYS, 'eu-west-1');
    expect(items).toEqual([
      { resourceType: 'dynamodb', resourceId: 'eu-west-1:orders', resourceName: 'orders', state: 'active', region: 'eu-west-1', metadata: {} },
      { resourceType: 'dynamodb', resourceId: 'eu-west-1:events', resourceName: 'events', state: 'active', region: 'eu-west-1', metadata: {} },
    ]);
    // The DynamoDB JSON protocol needs a POST with a target header; a GET would
    // not be a valid ListTables call.
    expect(fetch).toHaveBeenCalledWith('https://dynamodb.eu-west-1.amazonaws.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'DynamoDB_20120810.ListTables' },
      body: JSON.stringify({}),
    });
  });

  it('signs the request for the dynamodb service in the requested region', async () => {
    const { clientFactory } = factoryReturning(ok(JSON.stringify({ TableNames: [] })));
    await new DynamoDbCollector(clientFactory as never).listTables(KEYS, 'ap-south-1');
    expect(clientFactory).toHaveBeenCalledWith({ service: 'dynamodb', region: 'ap-south-1', keys: KEYS });
  });

  it('returns an empty list when TableNames is absent', async () => {
    const { clientFactory } = factoryReturning(ok(JSON.stringify({})));
    await expect(new DynamoDbCollector(clientFactory as never).listTables(KEYS)).resolves.toEqual([]);
  });

  it('returns an empty list on a denied call rather than throwing', async () => {
    const { clientFactory } = factoryReturning(new Response('denied', { status: 403 }));
    await expect(new DynamoDbCollector(clientFactory as never).listTables(KEYS)).resolves.toEqual([]);
  });
});
