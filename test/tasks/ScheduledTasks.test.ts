import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { AuditLogCleanupTask } from '@aws-access-bridge/background/scheduled/AuditLogCleanupTask';
import { IScheduledTask } from '@aws-access-bridge/background/scheduled/IScheduledTask';
import type { IEnv, TaskRunSummary } from '@aws-access-bridge/background/scheduled/IScheduledTask';

vi.mock('@aws-access-bridge/backend-data/dao/AuditLogDAO');
vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');

function createEvent(): ScheduledController {
  return { cron: '*/10 * * * *', scheduledTime: 123, noRetry: () => undefined };
}

class TrackedTask extends IScheduledTask<IEnv> {
  public calls = 0;

  protected override getTaskType(): string {
    return 'test-task';
  }

  protected async handleScheduledTask(): Promise<TaskRunSummary> {
    this.calls += 1;
    return { itemsProcessed: 2, itemsFailed: 0, summary: 'ok' };
  }
}

class UntrackedTask extends IScheduledTask<IEnv> {
  protected async handleScheduledTask(): Promise<void> {}
}

describe('IScheduledTask run tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records start/success around a tracked task', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
    const task = new TrackedTask();
    await task.handle(createEvent(), { AccessBridgeDB: {} as unknown as D1Database } as unknown as Env, {} as unknown as ExecutionContext);
    expect(task.calls).toBe(1);
    expect(BackgroundTaskRunDAO.prototype.startRun).toHaveBeenCalledWith({ taskType: 'test-task' });
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', {
      itemsProcessed: 2,
      itemsFailed: 0,
      summary: 'ok',
    });
  });

  it('records failure when the task throws', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-9');
    vi.mocked(BackgroundTaskRunDAO.prototype.failRun).mockResolvedValue(undefined);
    class FailingTask extends IScheduledTask<IEnv> {
      protected override getTaskType(): string {
        return 'failing-task';
      }

      protected async handleScheduledTask(): Promise<void> {
        throw new Error('kaput');
      }
    }
    await new FailingTask().handle(
      createEvent(),
      { AccessBridgeDB: {} as unknown as D1Database } as unknown as Env,
      {} as unknown as ExecutionContext,
    );
    expect(BackgroundTaskRunDAO.prototype.failRun).toHaveBeenCalledWith('run-9', 'Error: kaput');
  });

  it('skips tracking for tasks without a task type', async () => {
    await new UntrackedTask().handle(createEvent(), {} as unknown as Env, {} as unknown as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.startRun).not.toHaveBeenCalled();
  });

  it('still runs the task when the run record cannot start', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockRejectedValue(new Error('D1 down'));
    const task = new TrackedTask();
    await task.handle(createEvent(), { AccessBridgeDB: {} as unknown as D1Database } as unknown as Env, {} as unknown as ExecutionContext);
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
    await task.handle(createEvent(), { AccessBridgeDB: {} as unknown as D1Database } as unknown as Env, {} as unknown as ExecutionContext);
    expect(AuditLogDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledTimes(2);
    expect(AuditLogDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-2', {
      itemsProcessed: 620,
      itemsFailed: 0,
      summary: 'Pruned 620 rows older than 90 days',
    });
  });
});
