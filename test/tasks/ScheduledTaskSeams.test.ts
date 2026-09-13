import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IScheduledTask } from '@aws-access-bridge/background/scheduled/IScheduledTask';
import { AbstractCollectionTask } from '@aws-access-bridge/background/scheduled/AbstractCollectionTask';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');
vi.mock('@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO');
vi.mock('@aws-access-bridge/backend-services/credential', () => ({
  CredentialServiceFactory: { create: vi.fn() },
}));

class StubTask extends IScheduledTask<{ AccessBridgeDB: D1Database }> {
  public daoCalls = 0;
  protected override getTaskType(): string {
    return 'stub-task';
  }
  protected override createTaskRunDAO(db: D1Database): BackgroundTaskRunDAO {
    this.daoCalls += 1;
    return new BackgroundTaskRunDAO(db);
  }
  protected override async handleScheduledTask(): Promise<{ itemsProcessed: number; itemsFailed: number }> {
    return { itemsProcessed: 1, itemsFailed: 0 };
  }
}

class StubCollectionTask extends AbstractCollectionTask<{ AccessBridgeDB: D1Database } & Record<string, unknown>> {
  protected override getTaskType(): string {
    return 'stub-collection';
  }
  protected collectionType(): 'cost' {
    return 'cost';
  }
  protected maxAccountsPerCollection(): number {
    return 3;
  }
  protected collectionIntervalHours(): number {
    return 1;
  }
  protected sessionName(): string {
    return 'test';
  }
  protected override async collectForAccount(): Promise<number> {
    return 2;
  }
}

function event(): ScheduledController {
  return { cron: '* * * * *', scheduledTime: 1, noRetry: () => undefined };
}

describe('IScheduledTask factory seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks runs through the injectable DAO factory', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    const task = new StubTask();
    await task.handle(event(), { AccessBridgeDB: {} } as unknown as Env, {} as ExecutionContext);
    expect(task.daoCalls).toBeGreaterThan(0);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 1 }));
  });

  it('marks runs failed on uncaught errors', async () => {
    class FailingTask extends StubTask {
      protected override async handleScheduledTask(): Promise<never> {
        throw new Error('boom');
      }
    }
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-2');
    vi.mocked(BackgroundTaskRunDAO.prototype.failRun).mockResolvedValue(undefined);
    await new FailingTask().handle(event(), { AccessBridgeDB: {} } as unknown as Env, {} as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.failRun).toHaveBeenCalledWith('run-2', expect.stringContaining('boom'));
  });
});

describe('AbstractCollectionTask template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the shared loop and counts per-account items', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([
      'arn:aws:iam::123456789012:role/Dev',
      'arn:aws:iam::123456789012:role/Ops',
    ]);
    vi.mocked(CredentialServiceFactory.create).mockReturnValue({
      resolveLeafCredentials: vi.fn().mockResolvedValue({ credentials: { accessKeyId: 'A' } as AccessKeys }),
    } as never);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-3');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new StubCollectionTask().handle(event(), { AccessBridgeDB: {} } as unknown as Env, {} as ExecutionContext);
    expect(DataCollectionConfigDAO.prototype.updateLastCollectedTime).toHaveBeenCalledTimes(2);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-3', expect.objectContaining({ itemsProcessed: 4 }));
  });

  it('short-circuits when nothing is due', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([]);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    await new StubCollectionTask().handle(event(), { AccessBridgeDB: {} } as unknown as Env, {} as ExecutionContext);
    expect(CredentialServiceFactory.create).not.toHaveBeenCalled();
  });
});
