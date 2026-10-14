import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { AuditLogCleanupTask } from '@aws-access-bridge/background/scheduled/AuditLogCleanupTask';
import { CronTask } from '@aws-access-bridge/background/scheduled/CronTask';
import type { IEnv } from '@aws-access-bridge/background/scheduled/CronTask';
import type { TaskRunSummary } from '@rexezuge/runtime';

vi.mock('@aws-access-bridge/backend-data/dao/AuditLogDAO');
vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');

function createEvent(): ScheduledController {
  return { cron: '*/10 * * * *', scheduledTime: 123, noRetry: () => {} };
}

/**
 * Named rather than inlined: the template takes `TEnv`, and five call sites would
 * otherwise each carry the same cast.
 */
function runEnv(): IEnv {
  return { AccessBridgeDB: {} } as unknown as IEnv;
}

class TrackedTask extends CronTask<IEnv> {
  public calls = 0;

  protected override getTaskType(): string {
    return 'test-task';
  }

  protected async handleScheduledTask(): Promise<TaskRunSummary> {
    this.calls += 1;
    return { itemsProcessed: 2, itemsFailed: 0, summary: 'ok' };
  }
}

class UntrackedTask extends CronTask<IEnv> {
  protected async handleScheduledTask(): Promise<TaskRunSummary> {
    return { itemsProcessed: 0, itemsFailed: 0 };
  }
}

describe('CronTask run tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records start/success around a tracked task', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    const task = new TrackedTask();
    await task.handle(createEvent(), runEnv(), {} as unknown as ExecutionContext);
    expect(task.calls).toBe(1);
    expect(BackgroundTaskRunDAO.prototype.startRun).toHaveBeenCalledWith({ taskType: 'test-task' });
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', {
      itemsProcessed: 2,
      itemsFailed: 0,
      summary: 'ok',
    });
  });

  it('records the failure, then rethrows so the caller sees the cron failed', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-9');
    vi.mocked(BackgroundTaskRunDAO.prototype.failRun).mockResolvedValue(undefined);
    class FailingTask extends CronTask<IEnv> {
      protected override getTaskType(): string {
        return 'failing-task';
      }

      protected async handleScheduledTask(): Promise<TaskRunSummary> {
        throw new Error('kaput');
      }
    }
    // The original error reaches the caller, not a summary of it. The template
    // writes `failRun` **before** it re-raises, so the run row already says why by
    // the time `CronTasksWorker` sees the rejection — which is what makes the
    // cron answer `failed` instead of `completed`.
    await expect(new FailingTask().handle(createEvent(), runEnv(), {} as unknown as ExecutionContext)).rejects.toThrow('kaput');
    expect(BackgroundTaskRunDAO.prototype.failRun).toHaveBeenCalledWith('run-9', 'kaput', undefined);
  });

  it('skips tracking for tasks without a task type', async () => {
    await new UntrackedTask().handle(createEvent(), runEnv(), {} as unknown as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.startRun).not.toHaveBeenCalled();
  });

  it('still runs the task when the run record cannot start', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockRejectedValue(new Error('D1 down'));
    const task = new TrackedTask();
    await task.handle(createEvent(), runEnv(), {} as unknown as ExecutionContext);
    expect(task.calls).toBe(1);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).not.toHaveBeenCalled();
  });
});

describe('AuditLogCleanupTask pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prunes in batches until a partial batch and records the run', async () => {
    vi.mocked(AuditLogDAO.prototype.deleteOlderThanBatch).mockResolvedValueOnce(500).mockResolvedValueOnce(120);
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-2');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    const task = new AuditLogCleanupTask();
    await task.handle(createEvent(), runEnv(), {} as unknown as ExecutionContext);
    expect(AuditLogDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledTimes(2);
    expect(AuditLogDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-2', {
      itemsProcessed: 620,
      itemsFailed: 0,
      summary: 'Pruned 620 rows older than 90 days',
    });
  });
});
