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
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  } as unknown as Env;
}

const CHAIN = {
  principalArns: ['arn:aws:iam::123456789012:role/Dev', 'arn:aws:iam::123456789012:user/base'],
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  sessionToken: 'token',
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
});

describe('CredentialCacheRefreshTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes due principals and summarizes', async () => {
    vi.mocked(CredentialCacheConfigDAO.prototype.getPrincipalArnsNeedingUpdate).mockResolvedValue(['arn:aws:iam::123456789012:role/Dev']);
    vi.mocked(CredentialsDAO.prototype.getCredentialChainByPrincipalArn).mockResolvedValue(CHAIN);
    vi.mocked(StsService.prototype.assumeRole).mockResolvedValue(ASSUMED);
    vi.mocked(CredentialsCacheDAO.prototype.storeCachedCredential).mockResolvedValue(undefined);
    vi.mocked(CredentialCacheConfigDAO.prototype.updateLastCachedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-5');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new CredentialCacheRefreshTask().handle(createEvent(), taskEnv(), {} as unknown as ExecutionContext);
    expect(CredentialsCacheDAO.prototype.storeCachedCredential).toHaveBeenCalledTimes(1);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith(
      'run-5',
      expect.objectContaining({ itemsProcessed: 1, itemsFailed: 0 }),
    );
  });
});
