import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao';

interface TaskRunSummary {
  itemsProcessed: number;
  itemsFailed: number;
  summary?: string;
  details?: unknown;
}

abstract class IScheduledTask<TEnv extends IEnv> {
  // Override to opt into automatic global run tracking via the Template Method.
  // Tasks returning void skip run tracking; tasks returning a TaskRunSummary
  // get a `background_task_runs` record (visible via GET /user/admin/maintenance/task-runs).
  protected getTaskType(): string | null {
    return null;
  }

  public async handle(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tEnv = env as unknown as TEnv;
    const taskType = this.getTaskType();
    const db: D1Database | undefined =
      'AccessBridgeDB' in tEnv ? (tEnv as unknown as { AccessBridgeDB: D1Database }).AccessBridgeDB : undefined;

    let runId: string | undefined;
    if (taskType && db) {
      const dao = new BackgroundTaskRunDAO(db);
      runId = await dao.startRun({ taskType }).catch((error: unknown) => {
        console.warn(`[${this.constructor.name}] Failed to start task run record:`, error);
        return undefined;
      });
    }

    try {
      const result = await this.handleScheduledTask(event, tEnv, ctx);
      if (runId && db) {
        const dao = new BackgroundTaskRunDAO(db);
        await dao.succeedRun(runId, result ?? { itemsProcessed: 0, itemsFailed: 0 }).catch((error: unknown) => {
          console.warn(`[${this.constructor.name}] Failed to mark task run succeeded:`, error);
        });
      }
    } catch (error: unknown) {
      console.error(`[${this.constructor.name}] Uncaught error:`, error);
      if (runId && db) {
        const dao = new BackgroundTaskRunDAO(db);
        await dao.failRun(runId, String(error)).catch((recordError: unknown) => {
          console.warn(`[${this.constructor.name}] Failed to mark task run failed:`, recordError);
        });
      }
    }
  }

  // Return type is widened to TaskRunSummary | void for backward compatibility.
  // Existing tasks returning void satisfy this signature without changes.
  // New observable tasks return TaskRunSummary for richer run records.
  protected abstract handleScheduledTask(event: ScheduledController, env: TEnv, ctx: ExecutionContext): Promise<TaskRunSummary | void>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IEnv {}

export { IScheduledTask };
export type { IEnv, TaskRunSummary };
