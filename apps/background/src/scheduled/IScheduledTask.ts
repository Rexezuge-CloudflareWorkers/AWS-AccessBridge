import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao';

import { log } from '@aws-access-bridge/shared/utils';
interface TaskRunSummary {
  itemsProcessed: number;
  itemsFailed: number;
  summary?: string;
  details?: unknown;
}

abstract class IScheduledTask<TEnv extends IEnv> {
  // Override to opt into automatic global run tracking via the Template Method.
  // Tasks that leave this null skip run tracking; tasks that return a type get a
  // `background_task_runs` record (visible via GET /user/admin/maintenance/task-runs).
  protected getTaskType(): string | null {
    return null;
  }

  // Factory-Method seam (Otter `IScheduledTask.createTaskRunDAO` precedent):
  // tests override this to inject a stub DAO without D1.
  protected createTaskRunDAO(db: D1Database): BackgroundTaskRunDAO {
    return new BackgroundTaskRunDAO(db);
  }

  public async handle(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tEnv = env as unknown as TEnv;
    const taskType = this.getTaskType();
    const db: D1Database | undefined =
      'AccessBridgeDB' in tEnv ? (tEnv as unknown as { AccessBridgeDB: D1Database }).AccessBridgeDB : undefined;

    let runId: string | undefined;
    if (taskType && db) {
      const dao = this.createTaskRunDAO(db);
      runId = await dao.startRun({ taskType }).catch((error: unknown) => {
        log.warn(`[${this.constructor.name}] Failed to start task run record:`, { error: error });
        return undefined;
      });
    }

    try {
      const result = await this.handleScheduledTask(event, tEnv, ctx);
      if (runId && db) {
        const dao = this.createTaskRunDAO(db);
        await dao.succeedRun(runId, result).catch((error: unknown) => {
          log.warn(`[${this.constructor.name}] Failed to mark task run succeeded:`, { error: error });
        });
      }
    } catch (error: unknown) {
      log.error(`[${this.constructor.name}] Uncaught error:`, { error: error });
      if (runId && db) {
        const dao = this.createTaskRunDAO(db);
        await dao.failRun(runId, String(error)).catch((recordError: unknown) => {
          log.warn(`[${this.constructor.name}] Failed to mark task run failed:`, { error: recordError });
        });
      }
      // Re-throw after recording. The run record is durable, but swallowing here
      // left the caller (CronTasksWorker) reporting "completed" for a task that
      // failed outright, so cron failures were invisible in its logs and status.
      throw error;
    }
  }

  // Every task reports a TaskRunSummary; it is recorded only when `getTaskType()` opts in.
  protected abstract handleScheduledTask(event: ScheduledController, env: TEnv, ctx: ExecutionContext): Promise<TaskRunSummary>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IEnv {}

export { IScheduledTask };
export type { IEnv, TaskRunSummary };
