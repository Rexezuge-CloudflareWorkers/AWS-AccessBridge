import { describe, expect, it } from 'vitest';
import { Ec2Collector, LambdaCollector, RdsCollector, S3Collector } from '@aws-access-bridge/backend-services/aws';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from '@aws-access-bridge/backend-services/aws';
import { ACCOUNT_A, accountKeys, flociClientFactory } from './helpers/floci';
import { createBucketWithObject, createDbInstance } from './helpers/seed';

/**
 * Four of the five inventory collectors over real signed round trips.
 *
 * Three of them parse XML with `matchAll` over positional tags — the
 * `Ec2Collector` in particular pairs `<instanceId>`, `<name>` and the `Name` tag
 * by *array index*, which is the kind of coupling a stub cannot falsify and a
 * real response can. RDS does the same with `<DBInstanceIdentifier>`,
 * `<DBInstanceStatus>` and `<Engine>`.
 *
 * S3, RDS and EC2 are seeded to a non-empty state. Lambda is asserted at the
 * parse level instead: seeding it means a real container launch
 * (`CreateFunction`) or emulator-wide mock flags whose defaults would then have
 * to be pinned, and neither buys parser coverage the seeded ones do not give.
 *
 * **`DynamoDbCollector` is absent, and that is a finding rather than an
 * oversight.** Its `X-Amz-Target: DynamoDB_20120810.ListTables` is not
 * recognised by Floci, which answers `404 UnknownOperationException` — measured
 * against Floci 2.1.0, for `ListTables` and `CreateTable` alike. No request shape
 * we can send reaches it, so the collector has no emulator coverage until Floci
 * implements the target namespace. Its parsing is covered by the stubbed unit
 * suite (`test/collectors/AwsCollectors.test.ts`), and this omission should be
 * revisited when Floci next lands DynamoDB targets.
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
    expect(database?.region).toBe('us-east-1');
    expectWellFormed(items);
  });

  // These two assert the endpoint and the response contract, not discovered
  // content: `BaseAwsCollector` throws on a non-OK status or an unparseable
  // body, so simply resolving is the assertion. That is the part a stub cannot
  // prove — a wrong path, or Query parameters left in the query string where the
  // emulator cannot see them, is a silent empty answer here.
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
});
