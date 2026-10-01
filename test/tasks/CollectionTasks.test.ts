import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostDataCollectionTask } from '@aws-access-bridge/background/scheduled/CostDataCollectionTask';
import { ResourceInventoryCollectionTask } from '@aws-access-bridge/background/scheduled/ResourceInventoryCollectionTask';
import { CredentialCacheRefreshTask } from '@aws-access-bridge/background/scheduled/CredentialCacheRefreshTask';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { CredentialCacheConfigDAO } from '@aws-access-bridge/backend-data/dao/CredentialCacheConfigDAO';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { CostExplorerService } from '@aws-access-bridge/backend-services/aws/ce';

vi.mock('@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CostDataDAO');
vi.mock('@aws-access-bridge/backend-data/dao/ResourceInventoryDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialCacheConfigDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CredentialsCacheDAO');
vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');
vi.mock('@aws-access-bridge/backend-services/aws/sts');
vi.mock('@aws-access-bridge/backend-services/aws/ce');

const { stubCollectors } = vi.hoisted(() => {
  const makeCollector = (resourceType: string) => ({ resourceType, collect: vi.fn().mockResolvedValue([]) });
  return {
    stubCollectors: new Map([
      ['ec2', makeCollector('ec2')],
      ['s3', makeCollector('s3')],
      ['lambda', makeCollector('lambda')],
      ['rds', makeCollector('rds')],
      ['dynamodb', makeCollector('dynamodb')],
    ]),
  };
});

vi.mock('@aws-access-bridge/backend-services/aws/collectors', () => ({
  CollectorRegistry: {
    get: vi.fn(),
    getAll: () => stubCollectors,
  },
}));

function createEvent(): ScheduledController {
  return { cron: '*/10 * * * *', scheduledTime: 123, noRetry: () => undefined };
}

function taskEnv() {
  return {
    AccessBridgeDB: {},
    AccessBridgeKV: {},
    CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  } as unknown as Env;
}

// `principalArns[0]` is the target role and the last entry is the base IAM user,
// so this two-element chain has no cacheable intermediate hop.
const CHAIN = {
  principalArns: ['arn:aws:iam::123456789012:role/Dev', 'arn:aws:iam::123456789012:user/base'],
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  sessionToken: 'token',
};

// A two-hop chain: target -> Mid -> base. Only `Mid` is pre-warmed.
const CHAIN_WITH_INTERMEDIATE = {
  ...CHAIN,
  principalArns: [
    'arn:aws:iam::123456789012:role/Dev',
    'arn:aws:iam::123456789012:role/Mid',
    'arn:aws:iam::123456789012:user/base',
  ],
};

const ASSUMED = {
  accessKeyId: 'ASIA',
  secretAccessKey: 'shh',
  sessionToken: 'tok',
  expiration: '2025-01-01T00:00:00Z',
};

describe('CostDataCollectionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not advance the collection interval when a principal reported no data', async () => {
    // The collectors answer 0 for a genuinely empty account and for one AWS is
    // refusing, so stamping either way meant an inaccessible account was not
    // retried until the next full interval — 6 hours for cost, 2 for resources.
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(CostExplorerService.prototype.getCostAndUsage).mockResolvedValue([]);
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([]);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-x');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CostDataCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(DataCollectionConfigDAO.prototype.updateLastCollectedTime).not.toHaveBeenCalled();
  });

  it('advances the collection interval when a principal produced data', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(CostExplorerService.prototype.getCostAndUsage).mockResolvedValue([
      { accountId: '', periodStart: '2025-01-01', periodEnd: '2025-01-02', totalCost: 1.5, currency: 'USD', serviceBreakdown: { EC2: 1.5 } },
    ]);
    vi.mocked(CostDataDAO.prototype.upsertCostData).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-y');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CostDataCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(DataCollectionConfigDAO.prototype.updateLastCollectedTime).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/Dev', 'cost');
  });

  it('collects cost data for due accounts and summarizes', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([
      'arn:aws:iam::123456789012:role/Dev',
    ]);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(CostExplorerService.prototype.getCostAndUsage).mockResolvedValue([
      { accountId: '', periodStart: '2025-01-01', periodEnd: '2025-01-02', totalCost: 1, currency: 'USD', serviceBreakdown: {} },
    ]);
    vi.mocked(CostDataDAO.prototype.upsertCostData).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CostDataCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(CostExplorerService.prototype.getCostAndUsage).toHaveBeenCalledTimes(1);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ itemsProcessed: 1, itemsFailed: 0 }),
    );
  });

  it('counts per-account failures without failing the run', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([
      'arn:aws:iam::123456789012:role/Dev',
    ]);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockRejectedValue(new Error('no chain'));
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-2');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CostDataCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({ itemsProcessed: 0, itemsFailed: 1 }),
    );
  });

  it('reports empty when nothing is due', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([]);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-3');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CostDataCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(CostExplorerService.prototype.getCostAndUsage).not.toHaveBeenCalled();
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-3',
      expect.objectContaining({ itemsProcessed: 0, itemsFailed: 0 }),
    );
  });
});

describe('ResourceInventoryCollectionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const collector of stubCollectors.values()) {
      vi.mocked(collector.collect).mockResolvedValue([]);
    }
  });

  it('collects resources and cleans stale rows', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([
      'arn:aws:iam::123456789012:role/Dev',
    ]);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(stubCollectors.get('ec2')!.collect).mockResolvedValue([
      { resourceType: 'ec2', resourceId: 'i-1', resourceName: 'web', state: 'running', region: 'us-east-1', metadata: {} },
    ]);
    vi.mocked(ResourceInventoryDAO.prototype.upsertResource).mockResolvedValue(undefined);
    vi.mocked(ResourceInventoryDAO.prototype.deleteStaleResources).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new ResourceInventoryCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(ResourceInventoryDAO.prototype.upsertResource).toHaveBeenCalledTimes(1);
    expect(ResourceInventoryDAO.prototype.deleteStaleResources).toHaveBeenCalledTimes(5);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-4',
      expect.objectContaining({ itemsProcessed: 1, itemsFailed: 0 }),
    );
  });

  it('does not prune a resource type whose collector failed', async () => {
    // Regression guard: a transient AWS failure (throttling, a lost IAM
    // permission) must not delete the account's previously collected rows of
    // that type. Only types that actually reported this run may be pruned.
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(stubCollectors.get('ec2')!.collect).mockResolvedValue([
      { resourceType: 'ec2', resourceId: 'i-1', resourceName: 'web', state: 'running', region: 'us-east-1', metadata: {} },
    ]);
    vi.mocked(stubCollectors.get('s3')!.collect).mockRejectedValue(new Error('AccessDenied: s3:ListAllMyBuckets'));
    vi.mocked(ResourceInventoryDAO.prototype.upsertResource).mockResolvedValue(undefined);
    vi.mocked(ResourceInventoryDAO.prototype.deleteStaleResources).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new ResourceInventoryCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    const prunedTypes = vi.mocked(ResourceInventoryDAO.prototype.deleteStaleResources).mock.calls.map((call) => call[1]);
    expect(prunedTypes).not.toContain('s3');
    expect(prunedTypes).toEqual(expect.arrayContaining(['ec2', 'lambda', 'rds', 'dynamodb']));
    expect(prunedTypes).toHaveLength(4);
  });

  it('prunes nothing when every collector fails', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    for (const collector of stubCollectors.values()) {
      vi.mocked(collector.collect).mockRejectedValue(new Error('AWS unavailable'));
    }
    vi.mocked(ResourceInventoryDAO.prototype.upsertResource).mockResolvedValue(undefined);
    vi.mocked(ResourceInventoryDAO.prototype.deleteStaleResources).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new ResourceInventoryCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(ResourceInventoryDAO.prototype.deleteStaleResources).not.toHaveBeenCalled();
  });

  it('does prune a type that succeeded with an empty result', async () => {
    // The other half of the guard: an empty-but-successful call is a real
    // answer ("this account has none") and must clear stale rows. The distinction
    // the task relies on is empty-vs-threw, never empty-vs-non-empty.
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(ResourceInventoryDAO.prototype.upsertResource).mockResolvedValue(undefined);
    vi.mocked(ResourceInventoryDAO.prototype.deleteStaleResources).mockResolvedValue(undefined);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new ResourceInventoryCollectionTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(ResourceInventoryDAO.prototype.deleteStaleResources).toHaveBeenCalledTimes(5);
    expect(ResourceInventoryDAO.prototype.upsertResource).not.toHaveBeenCalled();
  });
});

describe('CredentialCacheRefreshTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const collector of stubCollectors.values()) {
      collector.collect.mockResolvedValue([]);
    }
  });

  function primeRefreshMocks(chain = CHAIN): void {
    vi.mocked(CredentialsCacheDAO.prototype.storeCachedCredential).mockResolvedValue(undefined);
    vi.mocked(CredentialCacheConfigDAO.prototype.updateLastCachedTime).mockResolvedValue(undefined);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(chain);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-5');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
  }

  it('refreshes due principals and summarizes', async () => {
    vi.mocked(CredentialCacheConfigDAO.prototype.getPrincipalArnsNeedingUpdate).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    primeRefreshMocks(CHAIN_WITH_INTERMEDIATE);

    await new CredentialCacheRefreshTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(CredentialsCacheDAO.prototype.storeCachedCredential).toHaveBeenCalledTimes(1);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-5',
      expect.objectContaining({ itemsProcessed: 1, itemsFailed: 0 }),
    );
  });

  it('never caches the target role or the base keys, and caches each intermediate hop under its own ARN', async () => {
    // Regression: the loop cached `principalArn` (the target) on every iteration,
    // so every write overwrote the same key and the cache was never usable —
    // `findClosestCachedCredential` and `getCredentialChainToFirstCachedPrincipal`
    // both skip index 0.
    const mid = 'arn:aws:iam::123456789012:role/Mid';
    const lower = 'arn:aws:iam::123456789012:role/Lower';
    vi.mocked(CredentialCacheConfigDAO.prototype.getPrincipalArnsNeedingUpdate).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    primeRefreshMocks({ ...CHAIN, principalArns: ['arn:aws:iam::123456789012:role/Dev', mid, lower, 'arn:aws:iam::123456789012:user/base'] });

    await new CredentialCacheRefreshTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    const cachedArns = vi.mocked(CredentialsCacheDAO.prototype.storeCachedCredential).mock.calls.map(([entry]) => entry.principalArn);
    expect(cachedArns).toEqual([lower, mid]);
    expect(new Set(cachedArns).size).toBe(cachedArns.length);
  });

  it('advances last_cached_at even when a single-hop chain has nothing to pre-warm', async () => {
    // A one-hop chain (target + base) has no cacheable intermediate. Bumping
    // last_cached_at per hop instead would leave the principal permanently due
    // and re-resolve its chain on every cron tick forever.
    vi.mocked(CredentialCacheConfigDAO.prototype.getPrincipalArnsNeedingUpdate).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    primeRefreshMocks();

    await new CredentialCacheRefreshTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(CredentialsCacheDAO.prototype.storeCachedCredential).not.toHaveBeenCalled();
    expect(CredentialCacheConfigDAO.prototype.updateLastCachedTime).toHaveBeenCalledTimes(1);
  });

  it('isolates one unresolvable principal from the rest of the batch', async () => {
    vi.mocked(CredentialCacheConfigDAO.prototype.getPrincipalArnsNeedingUpdate).mockResolvedValue([
      'arn:aws:iam::123456789012:role/Bad',
      'arn:aws:iam::123456789012:role/Dev',
    ]);
    primeRefreshMocks(CHAIN_WITH_INTERMEDIATE);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockRejectedValueOnce(new Error('chain is a cycle'));

    await new CredentialCacheRefreshTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);

    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-5',
      expect.objectContaining({ itemsProcessed: 1, itemsFailed: 1 }),
    );
  });
});
