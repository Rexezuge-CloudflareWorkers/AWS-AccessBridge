import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';

describe('BackgroundTaskRunDAO', () => {
  let mockDb: any;
  let mockStmt: any;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn(),
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    };
  });

  it('startRun inserts a running record and returns the run id', async () => {
    const dao = new BackgroundTaskRunDAO(mockDb);
    const runId: string = await dao.startRun({ taskType: 'cost-data-collection' });
    expect(typeof runId).toBe('string');
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO background_task_runs'));
    const bound: unknown[] = vi.mocked(mockStmt.bind).mock.calls[0] ?? [];
    expect(bound[1]).toBe('cost-data-collection');
  });

  it('succeedRun marks partial_success when items failed', async () => {
    const dao = new BackgroundTaskRunDAO(mockDb);
    await dao.succeedRun('run-1', { itemsProcessed: 3, itemsFailed: 1, summary: 'done' });
    const bound: unknown[] = vi.mocked(mockStmt.bind).mock.calls[0] ?? [];
    expect(bound[0]).toBe('partial_success');
    expect(bound[1]).toBe(3);
    expect(bound[2]).toBe(1);
  });

  it('succeedRun marks success when nothing failed', async () => {
    const dao = new BackgroundTaskRunDAO(mockDb);
    await dao.succeedRun('run-1', { itemsProcessed: 3, itemsFailed: 0 });
    const bound: unknown[] = vi.mocked(mockStmt.bind).mock.calls[0] ?? [];
    expect(bound[0]).toBe('success');
  });

  it('failRun records the error message', async () => {
    const dao = new BackgroundTaskRunDAO(mockDb);
    await dao.failRun('run-1', 'boom', { itemsProcessed: 1 });
    const bound: unknown[] = vi.mocked(mockStmt.bind).mock.calls[0] ?? [];
    expect(bound[0]).toBe('boom');
    expect(bound[1]).toBe(1);
  });

  it('skipRun records a skipped status with reason', async () => {
    const dao = new BackgroundTaskRunDAO(mockDb);
    await dao.skipRun('run-1', 'nothing due');
    const bound: unknown[] = vi.mocked(mockStmt.bind).mock.calls[0] ?? [];
    expect(bound[0]).toBe('nothing due');
  });

  it('listRuns maps rows to external models and parses details JSON', async () => {
    vi.mocked(mockStmt.all).mockResolvedValue({
      results: [
        {
          run_id: 'run-1',
          task_type: 'audit-log-cleanup',
          status: 'success',
          items_processed: 42,
          items_failed: 0,
          summary: 'Pruned 42 rows',
          details: '{"batches":2}',
          error_message: null,
          started_at: 100,
          completed_at: 110,
          created_at: 100,
        },
      ],
    } as unknown as D1Result);
    const dao = new BackgroundTaskRunDAO(mockDb);
    const runs = await dao.listRuns({ taskType: 'audit-log-cleanup', limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe('run-1');
    expect(runs[0]?.details).toEqual({ batches: 2 });
    expect(runs[0]?.itemsProcessed).toBe(42);
  });

  it('deleteOlderThanBatch returns the deleted count', async () => {
    vi.mocked(mockStmt.run).mockResolvedValue({ success: true, meta: { changes: 500 } } as unknown as D1Result);
    const dao = new BackgroundTaskRunDAO(mockDb);
    await expect(dao.deleteOlderThanBatch(100, 500)).resolves.toBe(500);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT ?'));
  });

  it('throws DatabaseError when writes fail', async () => {
    vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'D1 down' } as unknown as D1Result);
    const dao = new BackgroundTaskRunDAO(mockDb);
    await expect(dao.startRun({ taskType: 'x' })).rejects.toThrow('Failed to start background task run');
  });
});
