import { describe, it, expect, vi } from 'vitest';
import { Ec2Collector } from '@aws-access-bridge/backend-services/aws/collectors/Ec2Collector';
import { S3Collector } from '@aws-access-bridge/backend-services/aws/collectors/S3Collector';
import { LambdaCollector } from '@aws-access-bridge/backend-services/aws/collectors/LambdaCollector';
import { RdsCollector } from '@aws-access-bridge/backend-services/aws/collectors/RdsCollector';
import { DynamoDbCollector } from '@aws-access-bridge/backend-services/aws/collectors/DynamoDbCollector';
import { AwsCollectionError } from '@aws-access-bridge/backend-errors';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

const KEYS: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' };

/**
 * A signed-client double that replays a scripted page sequence and records every
 * request body, so a test can assert which continuation token was actually sent.
 */
function pagedClient(...pages: Array<Response | Error>) {
  const bodies: string[] = [];
  let index = 0;
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    const body: unknown = init?.body;
    if (typeof body === 'string') {
      bodies.push(body);
    }
    const next = pages[index++];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { bodies, clientFactory: vi.fn().mockReturnValue({ fetch }), fetch };
}

/**
 * The request body recorded for the `n`th call.
 *
 * Narrowed to a string rather than `String(...)`-coerced: `RequestInit.body` is a
 * union, and stringifying the non-string members would yield a misleading
 * `'[object Object]'` that reads like a passed assertion.
 */
function bodyOf(bodies: string[], index: number): string {
  return bodies[index] ?? '';
}

function json(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

/**
 * Every AWS list call here is paginated, and each service spells the protocol
 * differently. These tests pin all five, because the failure they guard is
 * silent and destructive: `ResourceInventoryCollectionTask` prunes previously
 * collected rows for any resource type whose collector returned, so a collector
 * that read one page of a multi-page list made the task *delete* the unreturned
 * remainder on every subsequent run. A large account's inventory was therefore
 * permanently capped at one page's worth.
 */
describe('EC2 pagination', () => {
  it('follows NextToken until it is exhausted', async () => {
    const { bodies, clientFactory, fetch } = pagedClient(
      xml('<DescribeInstancesResponse><nextToken>tok-1</nextToken><reservationSet><instancesSet><item><instanceId>i-1</instanceId></item></instancesSet></reservationSet></DescribeInstancesResponse>'),
      xml('<DescribeInstancesResponse><reservationSet><instancesSet><item><instanceId>i-2</instanceId></item></instancesSet></reservationSet></DescribeInstancesResponse>'),
    );

    const items = await new Ec2Collector(clientFactory as never).collect(KEYS);
    expect(items.map((i) => i.resourceId)).toEqual(['i-1', 'i-2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    // The second request must carry the token the first page returned.
    expect(bodyOf(bodies, 1)).toContain('NextToken=tok-1');
  });

  it('sends no token on the first page', async () => {
    const { bodies, clientFactory, fetch } = pagedClient(xml('<DescribeInstancesResponse></DescribeInstancesResponse>'));
    await new Ec2Collector(clientFactory as never).collect(KEYS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(bodies, 0)).not.toContain('NextToken');
  });

  it('stops rather than looping when a token repeats', async () => {
    // A non-advancing service would otherwise re-fetch the same page until the
    // request's wall-clock limit. Built as a factory so each call gets a fresh
    // readable body rather than an already-consumed one.
    const stuckPage = (): Response => xml('<DescribeInstancesResponse><nextToken>same</nextToken></DescribeInstancesResponse>');
    const { clientFactory, fetch } = pagedClient(stuckPage(), stuckPage(), stuckPage());
    await new Ec2Collector(clientFactory as never).collect(KEYS);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('still throws on a non-OK page, so a denial is not a short list', async () => {
    const { clientFactory } = pagedClient(
      xml('<DescribeInstancesResponse><nextToken>tok-1</nextToken></DescribeInstancesResponse>'),
      new Response('throttled', { status: 429 }),
    );
    await expect(new Ec2Collector(clientFactory as never).collect(KEYS)).rejects.toBeInstanceOf(AwsCollectionError);
  });
});

describe('Lambda pagination', () => {
  it('follows NextMarker until it is exhausted', async () => {
    const { clientFactory, fetch } = pagedClient(
      json({ Functions: [{ FunctionName: 'a', State: 'Active' }], NextMarker: 'm-1' }),
      json({ Functions: [{ FunctionName: 'b', State: 'Active' }] }),
    );

    const items = await new LambdaCollector(clientFactory as never).collect(KEYS);
    expect(items.map((i) => i.resourceName)).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toContain('Marker=m-1');
  });

  it('stops when NextMarker is absent', async () => {
    const { clientFactory, fetch } = pagedClient(json({ Functions: [{ FunctionName: 'a' }] }));
    await expect(new LambdaCollector(clientFactory as never).collect(KEYS)).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('RDS pagination', () => {
  it('follows the Query-protocol Marker until it is exhausted', async () => {
    const { bodies, clientFactory } = pagedClient(
      xml('<DescribeDBInstancesResponse><Marker>m-1</Marker><DBInstances><DBInstance><DBInstanceIdentifier>db-1</DBInstanceIdentifier></DBInstance></DBInstances></DescribeDBInstancesResponse>'),
      xml('<DescribeDBInstancesResponse><DBInstances><DBInstance><DBInstanceIdentifier>db-2</DBInstanceIdentifier></DBInstance></DBInstances></DescribeDBInstancesResponse>'),
    );

    const items = await new RdsCollector(clientFactory as never).collect(KEYS);
    expect(items.map((i) => i.resourceId)).toEqual(['db-1', 'db-2']);
    expect(bodyOf(bodies, 1)).toContain('Marker=m-1');
  });
});

describe('DynamoDB pagination', () => {
  it('resumes with ExclusiveStartTableName in the body', async () => {
    // DynamoDB's JSON protocol has no query-string parameters, so the cursor
    // travels in the request body rather than as a query argument.
    const { bodies, clientFactory, fetch } = pagedClient(
      json({ TableNames: ['t1'], LastEvaluatedTableName: 't1' }),
      json({ TableNames: ['t2'] }),
    );

    const items = await new DynamoDbCollector(clientFactory as never).collect(KEYS);
    expect(items.map((i) => i.resourceName)).toEqual(['t1', 't2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toBe('{}');
    expect(bodies[1]).toContain('ExclusiveStartTableName');
  });
});

describe('S3 pagination', () => {
  it('follows NextContinuationToken on the V2 listing', async () => {
    const { clientFactory, fetch } = pagedClient(
      xml('<ListAllMyBucketsResult><Buckets><Bucket><Name>b1</Name></Bucket></Buckets><NextContinuationToken>tok</NextContinuationToken></ListAllMyBucketsResult>'),
      xml('<ListAllMyBucketsResult><Buckets><Bucket><Name>b2</Name></Bucket></Buckets></ListAllMyBucketsResult>'),
    );

    const items = await new S3Collector(clientFactory as never).collect(KEYS);
    expect(items.map((i) => i.resourceId)).toEqual(['b1', 'b2']);
    expect(fetch.mock.calls[1]?.[0]).toContain('continuation-token=tok');
  });

  it('keeps reporting global-region buckets across pages', async () => {
    const { clientFactory } = pagedClient(
      xml('<ListAllMyBucketsResult><Buckets><Bucket><Name>b1</Name></Bucket></Buckets><NextContinuationToken>t</NextContinuationToken></ListAllMyBucketsResult>'),
      xml('<ListAllMyBucketsResult><Buckets><Bucket><Name>b2</Name></Bucket></Buckets></ListAllMyBucketsResult>'),
    );
    const items = await new S3Collector(clientFactory as never).collect(KEYS);
    expect(items.every((i) => i.region === 'global')).toBe(true);
  });
});