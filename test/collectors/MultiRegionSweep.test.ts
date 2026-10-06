import { describe, it, expect, vi } from 'vitest';
import { Ec2Collector } from '@aws-access-bridge/backend-services/aws/collectors/Ec2Collector';
import { S3Collector } from '@aws-access-bridge/backend-services/aws/collectors/S3Collector';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { DEFAULT_INVENTORY_REGIONS } from '@aws-access-bridge/backend-runtime/constants/InventoryRegions';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

const KEYS: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' };

const REGIONS = ['us-east-1', 'eu-west-1', 'ap-south-1'];

/**
Alphabetical, so a sweep order never decides the outcome.
*/
const byName = (left: string, right: string): number => left.localeCompare(right);

function instanceXml(id: string): string {
  return `<DescribeInstancesResponse><reservationSet><instancesSet><item><instanceId>${id}</instanceId></item></instancesSet></reservationSet></DescribeInstancesResponse>`;
}

/**
 * Resolves the region from the signed request's hostname, so a sweep can be
 * asserted region by region without hard-coding each endpoint.
 */
function clientFactoryRespondingTo(
  respond: (url: string) => Response | Error,
): { clientFactory: ReturnType<typeof vi.fn>; seenRegions: string[] } {
  const seenRegions: string[] = [];
  const fetch = vi.fn((url: string) => {
    seenRegions.push(regionFromUrl(url));
    const result = respond(url);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { clientFactory: vi.fn().mockReturnValue({ fetch }), seenRegions };
}

function regionFromUrl(url: string): string {
  return /ec2\.([a-z0-9-]+)\.amazonaws\.com/.exec(url)?.[1] ?? 'global';
}

/**
 * Inventory covered `us-east-1` and nothing else.
 *
 * `BaseAwsCollector.collect` took an optional region defaulting to `us-east-1`,
 * and its single production caller passed none — so an account's EC2, Lambda, RDS
 * and DynamoDB inventory reported only the `us-east-1` slice while the API and UI
 * both filter by region and presented it as complete. These tests pin the sweep
 * and, more importantly, its failure isolation.
 */
describe('multi-region sweep', () => {
  it('collects from every configured region', async () => {
    const { clientFactory, seenRegions } = clientFactoryRespondingTo((url) => {
      return new Response(instanceXml(`i-${regionFromUrl(url)}`), { status: 200, headers: { 'Content-Type': 'text/xml' } });
    });

    const sweep = await new Ec2Collector(clientFactory as never).collectAllRegions(KEYS, REGIONS);

    expect(seenRegions.toSorted(byName)).toEqual([...REGIONS].toSorted(byName));
    expect(sweep.failedRegions).toEqual([]);
    expect(sweep.succeededRegions.toSorted(byName)).toEqual([...REGIONS].toSorted(byName));
    // One instance per region, each tagged with the region it came from.
    expect(sweep.items).toHaveLength(3);
    expect(sweep.items.map((i) => i.region).toSorted(byName)).toEqual([...REGIONS].toSorted(byName));
  });

  /**
   * The property that makes pruning safe: a region that cannot be read is
   * reported, and the readable regions are still returned. Discarding them would
   * make one `AccessDenied` erase a real inventory.
   */
  it('isolates a denied region and still returns the rest', async () => {
    const { clientFactory } = clientFactoryRespondingTo((url) =>
      url.includes('eu-west-1') ? new Response('denied', { status: 403 }) : new Response(instanceXml('i-1'), { status: 200 }),
    );

    const sweep = await new Ec2Collector(clientFactory as never).collectAllRegions(KEYS, REGIONS);

    expect(sweep.succeededRegions.toSorted(byName)).toEqual(['ap-south-1', 'us-east-1']);
    expect(sweep.failedRegions).toHaveLength(1);
    expect(sweep.failedRegions[0].region).toBe('eu-west-1');
    // The reason is carried, so the task can log which region was unreadable.
    expect(sweep.failedRegions[0].reason).toBeTruthy();
    expect(sweep.items.length).toBeGreaterThan(0);
  });

  it('never throws for a regional failure', async () => {
    const { clientFactory } = clientFactoryRespondingTo(() => new Error('network down'));
    await expect(new Ec2Collector(clientFactory as never).collectAllRegions(KEYS, REGIONS)).resolves.toMatchObject({ failedRegions: expect.any(Array) });
  });

  /**
   * A global service answers the same wherever asked. Sweeping the region list
   * would issue N identical requests to `s3.amazonaws.com` per account and record
   * the same buckets N times.
   */
  it('sweeps a global collector exactly once, ignoring the region list', async () => {
    const { clientFactory, seenRegions } = clientFactoryRespondingTo(
      () => new Response('<ListAllMyBucketsResult><Buckets><Bucket><Name>b</Name></Bucket></Buckets></ListAllMyBucketsResult>', { status: 200 }),
    );

    const sweep = await new S3Collector(clientFactory as never).collectAllRegions(KEYS, REGIONS);

    // One request, not one per configured region.
    expect(seenRegions).toHaveLength(1);
    expect(sweep.succeededRegions).toEqual(['global']);
    expect(sweep.items).toHaveLength(1);
  });

  it('reports a global collector as non-regional', () => {
    expect(new S3Collector().isRegional).toBe(false);
    expect(new Ec2Collector().isRegional).toBe(true);
  });
});

describe('inventory region configuration', () => {
  it('falls back to the full commercial list when unset', () => {
    // An unset var must not sweep nothing: that would present an empty inventory
    // as a complete one.
    expect(ConfigurationManager.resource.getInventoryRegions({})).toEqual([...DEFAULT_INVENTORY_REGIONS]);
  });

  it('falls back rather than sweeping nothing when set to blank', () => {
    expect(ConfigurationManager.resource.getInventoryRegions({ INVENTORY_REGIONS: ' '.repeat(3) })).toEqual([...DEFAULT_INVENTORY_REGIONS]);
  });

  it('honours an explicit list', () => {
    expect(ConfigurationManager.resource.getInventoryRegions({ INVENTORY_REGIONS: 'us-east-1,eu-west-1' })).toEqual(['us-east-1', 'eu-west-1']);
  });

  /**
   * Each of these is a silent misconfiguration if taken raw: whitespace produces a
   * request to a non-existent endpoint, an empty entry an unsigned request to the
   * service root, and a duplicate multiplies the API calls per account.
   */
  it('normalises whitespace, case and duplicates out of the list', () => {
    expect(ConfigurationManager.resource.getInventoryRegions({ INVENTORY_REGIONS: ' us-east-1 , EU-WEST-1 ,us-east-1' })).toEqual([
      'us-east-1',
      'eu-west-1',
    ]);
  });

  it('covers us-east-1 in the default, which is the only region previously read', () => {
    expect(DEFAULT_INVENTORY_REGIONS).toContain('us-east-1');
    // And is genuinely multi-region, not a one-element list that happens to work.
    expect(DEFAULT_INVENTORY_REGIONS.length).toBeGreaterThan(10);
    expect(new Set(DEFAULT_INVENTORY_REGIONS).size).toBe(DEFAULT_INVENTORY_REGIONS.length);
  });
});