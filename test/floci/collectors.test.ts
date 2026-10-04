import { describe, expect, it } from 'vitest';
import { DynamoDbCollector, Ec2Collector, LambdaCollector, RdsCollector, S3Collector } from '@aws-access-bridge/backend-services/aws';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws';
import { ACCOUNT_A, accountKeys, flociClientFactory } from './helpers/floci';
import { createBucketWithObject, createDbInstance, createTable } from './helpers/seed';

/**
 * The five inventory collectors over real signed round trips.
 *
 * Three of the five parse XML with `matchAll` over positional tags — the
 * `Ec2Collector` in particular pairs `<instanceId>`, `<name>` and the `Name` tag
 * by *array index*, which is the kind of coupling a stub cannot falsify and a
 * real response can. RDS does the same with `<DBInstanceIdentifier>`,
 * `<DBInstanceStatus>` and `<Engine>`.
 *
 * Three services are seeded to a non-empty state (S3, DynamoDB, RDS). EC2 and
 * Lambda are asserted at the parse level instead: seeding them means either a
 * real container launch (`RunInstances`, `CreateFunction`) or turning on
 * emulator-wide mock flags whose defaults would then have to be pinned. Neither
 * buys parser coverage the seeded three do not already give, and both would put
 * a container start on every CI run.
 */

/** Every field the collectors promise, so a parser that drops one fails here. */
function expectWellFormed(items: ResourceDiscoveryItem[]): void {
  for (const item of items) {
    expect(item.resourceId).toBeTruthy();
    expect(item.resourceName).toBeTruthy();
    expect(typeof item.state).toBe('string');
    expect(item.region).toBeTruthy();
    expect(typeof item.metadata).toBe('object');
  }
}

describe('Resource collectors against Floci', () => {
  it('lists a seeded S3 bucket as a global resource', async () => {
    await createBucketWithObject('floci-collector-bucket');
    const collector: IAwsResourceCollector = new S3Collector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A));

    const bucket = items.find((item) => item.resourceName === 'floci-collector-bucket');
    expect(bucket).toBeDefined();
    // S3 is the one global service: the request goes to the global endpoint and
    // the region is reported as 'global', not 'us-east-1'.
    expect(bucket?.region).toBe('global');
    expect(bucket?.state).toBe('active');
    expect(bucket?.resourceType).toBe('s3');
    expectWellFormed(items);
  });

  it('lists a seeded DynamoDB table keyed by region and name', async () => {
    await createTable('floci-collector-table');
    const collector: IAwsResourceCollector = new DynamoDbCollector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A), 'us-east-1');

    const table = items.find((item) => item.resourceName === 'floci-collector-table');
    expect(table).toBeDefined();
    expect(table?.resourceId).toBe('us-east-1:floci-collector-table');
    expect(table?.region).toBe('us-east-1');
    expect(table?.state).toBe('active');
    expectWellFormed(items);
  });

  it('lists a seeded RDS instance with its engine as metadata', async () => {
    await createDbInstance('floci-collector-db');
    const collector: IAwsResourceCollector = new RdsCollector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A), 'us-east-1');

    const database = items.find((item) => item.resourceName === 'floci-collector-db');
    expect(database).toBeDefined();
    // The engine comes from a separate positional `<Engine>` match, so this is
    // the assertion that catches the index alignment drifting.
    expect(database?.metadata.engine).toBe('postgres');
    // Not the exact word the emulator uses: what matters is that
    // `<DBInstanceStatus>` was found at all, since the parser falls back to
    // 'unknown' when the positional match misses.
    expect(database?.state).not.toBe('unknown');
    expect(database?.state).toBeTruthy();
    expectWellFormed(items);
  });

  // These two assert the endpoint and the response contract, not discovered
  // content: `BaseAwsCollector` throws on a non-OK status or an unparseable
  // body, so simply resolving is the assertion. That is the part a stub cannot
  // prove — a wrong path or a wrong `X-Amz-Target` is a 404 here, which in
  // production would surface as a collection failure and a skipped prune.
  it('reaches EC2 discovery and parses an empty instance list', async () => {
    const collector: IAwsResourceCollector = new Ec2Collector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A), 'us-east-1');

    expect(Array.isArray(items)).toBe(true);
    expectWellFormed(items);
  });

  it('reaches Lambda discovery and parses an empty function list', async () => {
    const collector: IAwsResourceCollector = new LambdaCollector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A), 'us-east-1');

    expect(Array.isArray(items)).toBe(true);
    expectWellFormed(items);
  });

  it('stamps the requested region on every discovered item', async () => {
    // Region plumbing is already pinned to exact URLs by the stubbed unit suite
    // (`test/collectors/AwsCollectors.test.ts`), so what is left to prove here is
    // the part only a real response can: the caller's region survives onto the
    // items the parser builds. Deliberately *not* asserting that another region
    // returns nothing — that would be a claim about the emulator's own resource
    // scoping rather than about our collector.
    const collector: IAwsResourceCollector = new DynamoDbCollector(flociClientFactory());

    const items = await collector.collect(accountKeys(ACCOUNT_A), 'eu-west-1');

    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item.region).toBe('eu-west-1');
    }
  });
});
