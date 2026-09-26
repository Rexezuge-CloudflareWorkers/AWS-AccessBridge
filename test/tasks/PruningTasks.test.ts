import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackgroundTaskRunPruningTask } from '@aws-access-bridge/background/scheduled/BackgroundTaskRunPruningTask';
import { AuditLogCleanupTask } from '@aws-access-bridge/background/scheduled/AuditLogCleanupTask';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';

vi.mock('@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AuditLogDAO');

function createEvent(): ScheduledController {
  return { cron: '*/10 * * * *', scheduledTime: 0, noRetry: () => undefined };
}

function env(overrides: Record<string, string> = {}): Env {
  return { AccessBridgeDB: {} as unknown as D1Database, ...overrides } as unknown as Env;
}

describe('pruning tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Run tracking is provided by IScheduledTask.createTaskRunDAO for every task,
    // so the run record always goes through BackgroundTaskRunDAO regardless of
    // which table the task prunes.
    vi.mocked(BackgroundTaskRunDAO.prototype.startRun).mockResolvedValue('run-1');
    vi.mocked(BackgroundTaskRunDAO.prototype.succeedRun).mockResolvedValue(undefined);
  });

  it('prunes background task runs in batches and records the run', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(12);
    const result = await new BackgroundTaskRunPruningTask().handle(createEvent(), env(), {} as ExecutionContext);

    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
    expect(result).toBeUndefined();
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 12 }));
  });

  it('honours the PRUNE_BATCH_SIZE env var', async () => {
    // Regression guard: getBatchSize() used to return a hardcoded 500, so the
    // documented env var had no effect on pruning.
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(3);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env({ PRUNE_BATCH_SIZE: '7' }), {} as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 7);
  });

  it('keeps batching until a partial batch, summing the rows deleted', async () => {
    // A full batch means there may be more; only a short batch ends the loop.
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValueOnce(500).mockResolvedValueOnce(500).mockResolvedValueOnce(17);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env(), {} as ExecutionContext);

    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledTimes(3);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 1017 }));
  });

  it('stops immediately when the first batch is empty', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(0);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env(), {} as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledTimes(1);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 0 }));
  });

  it('applies the configured retention window to the cutoff', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(1);
    const now = Math.trunc(Date.now() / 1000);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env({ BACKGROUND_TASK_RUN_RETENTION_DAYS: '7' }), {} as ExecutionContext);
    const [cutoff] = vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mock.calls[0];
    // 7 days of retention, within a generous window for test execution time.
    expect(cutoff).toBeGreaterThan(now - 8 * 86_400);
    expect(cutoff).toBeLessThanOrEqual(now - 7 * 86_400);
  });

  it('prunes audit logs with their own retention window', async () => {
    vi.mocked(AuditLogDAO.prototype.deleteOlderThanBatch).mockResolvedValue(9);
    await new AuditLogCleanupTask().handle(createEvent(), env({ AUDIT_LOG_RETENTION_DAYS: '30' }), {} as ExecutionContext);
    expect(AuditLogDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
    expect(BackgroundTaskRunDAO.prototype.succeedRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ itemsProcessed: 9 }));
  });

  it('falls back to the default batch size for an unparseable PRUNE_BATCH_SIZE', async () => {
    // EnvParser deliberately coerces a bad value to the known-good default
    // rather than throwing: a typo in one tuning knob should not take the whole
    // retention job down.
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(1);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env({ PRUNE_BATCH_SIZE: 'lots' }), {} as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
  });

  it('falls back to the default for a non-positive PRUNE_BATCH_SIZE', async () => {
    vi.mocked(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).mockResolvedValue(1);
    await new BackgroundTaskRunPruningTask().handle(createEvent(), env({ PRUNE_BATCH_SIZE: '0' }), {} as ExecutionContext);
    expect(BackgroundTaskRunDAO.prototype.deleteOlderThanBatch).toHaveBeenCalledWith(expect.any(Number), 500);
  });
});
