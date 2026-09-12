import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { BackgroundTaskRun, BackgroundTaskRunInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

interface StartTaskRunInput {
  taskType: string;
}

interface CompleteTaskRunInput {
  itemsProcessed: number;
  itemsFailed: number;
  summary?: string;
  details?: unknown;
}

interface ListTaskRunsOptions {
  taskType?: string;
  status?: string;
  limit?: number;
}

class BackgroundTaskRunDAO extends BaseDAO {
  public async startRun(input: StartTaskRunInput): Promise<string> {
    const runId: string = UUIDUtil.getRandomUUID();
    const now: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        `INSERT INTO background_task_runs
           (run_id, task_type, status, items_processed, items_failed, started_at, created_at)
         VALUES (?, ?, 'running', 0, 0, ?, ?)`,
      )
      .bind(runId, input.taskType, now, now)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to start background task run: ${result.error}`);
    }
    return runId;
  }

  public async succeedRun(runId: string, input: CompleteTaskRunInput): Promise<void> {
    const status: string = input.itemsFailed > 0 ? 'partial_success' : 'success';
    const now: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        `UPDATE background_task_runs
         SET status = ?, items_processed = ?, items_failed = ?, summary = ?, details = ?, completed_at = ?
         WHERE run_id = ?`,
      )
      .bind(
        status,
        input.itemsProcessed,
        input.itemsFailed,
        input.summary ?? null,
        input.details === undefined ? null : JSON.stringify(input.details),
        now,
        runId,
      )
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to complete background task run: ${result.error}`);
    }
  }

  public async failRun(runId: string, errorMessage: string, partial?: Partial<CompleteTaskRunInput>): Promise<void> {
    const now: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        `UPDATE background_task_runs
         SET status = 'error', error_message = ?, items_processed = ?, items_failed = ?,
             summary = ?, details = ?, completed_at = ?
         WHERE run_id = ?`,
      )
      .bind(
        errorMessage,
        partial?.itemsProcessed ?? 0,
        partial?.itemsFailed ?? 0,
        partial?.summary ?? null,
        partial?.details === undefined ? null : JSON.stringify(partial.details),
        now,
        runId,
      )
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to fail background task run: ${result.error}`);
    }
  }

  public async skipRun(runId: string, reason?: string): Promise<void> {
    const now: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare(
        `UPDATE background_task_runs
         SET status = 'skipped', summary = ?, completed_at = ?
         WHERE run_id = ?`,
      )
      .bind(reason ?? null, now, runId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to skip background task run: ${result.error}`);
    }
  }

  public async listRuns(options?: ListTaskRunsOptions): Promise<BackgroundTaskRun[]> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (options?.taskType) {
      conditions.push('task_type = ?');
      bindings.push(options.taskType);
    }
    if (options?.status) {
      conditions.push('status = ?');
      bindings.push(options.status);
    }
    const whereClause: string = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit: number = options?.limit ?? 50;
    const results = await this.database
      .prepare(
        `SELECT run_id, task_type, status, items_processed, items_failed, summary, details,
                error_message, started_at, completed_at, created_at
         FROM background_task_runs ${whereClause}
         ORDER BY started_at DESC LIMIT ?`,
      )
      .bind(...bindings, limit)
      .all<BackgroundTaskRunInternal>();
    return (results.results || []).map((row) => BackgroundTaskRunDAO.toExternal(row));
  }

  public async deleteOlderThan(cutoffTimestamp: number): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM background_task_runs WHERE started_at < ?')
      .bind(cutoffTimestamp)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete old background task runs: ${result.error}`);
    }
    return result.meta?.changes ?? 0;
  }

  public async deleteOlderThanBatch(cutoffTimestamp: number, batchSize: number): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM background_task_runs WHERE started_at < ? LIMIT ?')
      .bind(cutoffTimestamp, batchSize)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to delete old background task runs: ${result.error}`);
    }
    return result.meta?.changes ?? 0;
  }

  private static toExternal(row: BackgroundTaskRunInternal): BackgroundTaskRun {
    let details: unknown;
    try {
      details = row.details === null ? null : JSON.parse(row.details);
    } catch {
      details = row.details;
    }
    return {
      runId: row.run_id,
      taskType: row.task_type,
      status: row.status,
      itemsProcessed: row.items_processed,
      itemsFailed: row.items_failed,
      summary: row.summary,
      details,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }
}

export { BackgroundTaskRunDAO };
export type { StartTaskRunInput, CompleteTaskRunInput, ListTaskRunsOptions };
