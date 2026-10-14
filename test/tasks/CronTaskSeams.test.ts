import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskRunRecorder } from '@rexezuge/runtime';
import { CronTask } from '@aws-access-bridge/background/scheduled/CronTask';
import type { IEnv } from '@aws-access-bridge/background/scheduled/CronTask';
import { AbstractCollectionTask } from '@aws-access-bridge/background/scheduled/AbstractCollectionTask';
import type { CollectionTaskEnv } from '@aws-access-bridge/background/scheduled/AbstractCollectionTask';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { createRequestScope } from '@aws-access-bridge/backend-services/composition';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');
vi.mock('@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO');
vi.mock('@aws-access-bridge/backend-services/composition', () => ({
  // The cron tasks build a fresh scope per run rather than using
  // `getRequestScope`: a Durable Object's `env` is stable for the object's
  // lifetime, so a cached scope would pin the memoized encryption keys and the
  // cron would keep using the old key after a rotation.
  createRequestScope: vi.fn(),
  Tokens: { CredentialChainService: Symbol('CredentialChainService') },
}));

/**
 * The kit's Factory Method is `createRunRecorder()` and returns the port rather
 * than a DAO — `@rexezuge/runtime` has no D1 dependency, and inverting the
 * package graph to let a task base import a DAO is what the seven copies in this
 * family each ended up doing. Counting the calls is what proves the seam exists:
 * a base that constructed its recorder inline would record identically.
 */
class StubTask extends CronTask<IEnv> {
  public recorderCalls = 0;
  public recorder: TaskRunRecorder | null = null;

  protected override getTaskType(): string {
    return 'stub-task';
  }

  protected override createRunRecorder(): TaskRunRecorder | null {
    this.recorderCalls += 1;
    this.recorder = super.createRunRecorder();
    return this.recorder;
  }

  protected override async handleScheduledTask(): Promise<{ itemsProcessed: number; itemsFailed: number }> {
    return { itemsProcessed: 1, itemsFailed: 0 };
  }
}

/**
 * Parameterised on the production `CollectionTaskEnv` rather than on a restatement of
 * it.
 *
 * The stub used to declare `{ AccessBridgeDB: D1Database } & Record<string, unknown>`,
 * which satisfies the index signature and the database but is missing members the
 * constraint requires — the two `CREDENTIAL_*_ENCRYPTION_KEY_SECRET` bindings and `AccessBridgeKV`. Naming the
 * real type means a binding added to `CollectionTaskEnv` later is a compile error here
 * rather than a silently absent member, which is the difference between a double that
 * models the platform and one that models a moment of it.
 */
class StubCollectionTask extends AbstractCollectionTask<CollectionTaskEnv> {
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
  return { cron: '* * * * *', scheduledTime: 1, noRetry: () => {} };
}

function env(): IEnv {
  return { AccessBridgeDB: {} } as unknown as IEnv;
}

describe('CronTask recorder seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks runs through the injectable recorder factory', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    const task = new StubTask();
    await task.handle(event(), env(), {} as ExecutionContext);
    expect(task.recorderCalls).toBeGreaterThan(0);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 1 }));
  });

  it("binds the port to this repository's table, including the skip status", async () => {
    // `skipped` was a declared status on the model that nothing wrote, so an
    // operator could not tell "found nothing to do" from "did the work".
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-s');
    const task = new StubTask();
    await task.handle(event(), env(), {} as ExecutionContext);
    await task.recorder?.skipRun('run-s', 'nothing due');

    expect(BackgroundTaskRunDAO.prototype.skipRun).toHaveBeenCalledWith('run-s', 'nothing due');
  });

  it('records the failure and rethrows, so CronTasksWorker reports the cron as failed', async () => {
    // The record is written first, so a caller that catches the rejection finds a
    // `failed` row rather than one stuck at `running`. The message names the task
    // rather than repeating the error the template already logged with its stack.
    class FailingTask extends StubTask {
      protected override async handleScheduledTask(): Promise<never> {
        throw new Error('boom');
      }
    }
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-2');
    vi.mocked(BackgroundTaskRunDAO.prototype.failRun).mockResolvedValue(undefined);

    // The original error, not a summary of it: the template records first and then
    // re-raises, so `CronTasksWorker` sees the failure and the run row already
    // says why. `message` rather than `String(error)` — the stringified form is
    // `Error: boom`, which an operator has to read past the class name.
    await expect(new FailingTask().handle(event(), env(), {} as ExecutionContext)).rejects.toThrow('boom');
    expect(BackgroundTaskRunDAO.prototype.failRun).toHaveBeenCalledWith('run-2', 'boom', undefined);
  });

  it('does not rethrow when only the run record bookkeeping fails', async () => {
    // Losing the record must not lose the run: a D1 blip while opening the record
    // is not a task failure, and reporting it as one would page someone for a
    // bookkeeping write.
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockRejectedValue(new Error('D1 down'));
    await expect(new StubTask().handle(event(), env(), {} as ExecutionContext)).resolves.toBeUndefined();
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
    vi.mocked(createRequestScope).mockReturnValue({
      get: vi.fn().mockReturnValue({
        resolveLeafCredentials: vi.fn().mockResolvedValue({ credentials: { accessKeyId: 'A' } as AccessKeys }),
      }),
    } as never);
    vi.mocked(DataCollectionConfigDAO.prototype.updateLastCollectedTime).mockResolvedValue(undefined);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-3');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);

    await new StubCollectionTask().handle(event(), { AccessBridgeDB: {} } as unknown as CollectionTaskEnv, {} as ExecutionContext);
    expect(DataCollectionConfigDAO.prototype.updateLastCollectedTime).toHaveBeenCalledTimes(2);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-3', expect.objectContaining({ itemsProcessed: 4 }));
  });

  it('short-circuits when nothing is due', async () => {
    vi.mocked(DataCollectionConfigDAO.prototype.getPrincipalArnsNeedingCollection).mockResolvedValue([]);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-4');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    await new StubCollectionTask().handle(event(), { AccessBridgeDB: {} } as unknown as CollectionTaskEnv, {} as ExecutionContext);
    expect(createRequestScope).not.toHaveBeenCalled();
  });
});
