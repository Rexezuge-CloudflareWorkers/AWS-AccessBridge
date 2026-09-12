import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao/BackgroundTaskRunDAO';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { AbstractPruningTask } from './AbstractPruningTask';
import type { IEnv } from './IScheduledTask';

class BackgroundTaskRunPruningTask extends AbstractPruningTask<BackgroundTaskRunPruningTaskEnv> {
  protected override getTaskType(): string {
    return 'background-task-run-pruning';
  }

  protected getRetentionDays(env: BackgroundTaskRunPruningTaskEnv): number {
    return ConfigurationManager.processing.getTaskRunRetentionDays(env);
  }

  protected async pruneBatch(db: D1Database, cutoffTimestamp: number, batchSize: number): Promise<number> {
    const dao: BackgroundTaskRunDAO = new BackgroundTaskRunDAO(db);
    return dao.deleteOlderThanBatch(cutoffTimestamp, batchSize);
  }
}

interface BackgroundTaskRunPruningTaskEnv extends IEnv {
  BACKGROUND_TASK_RUN_RETENTION_DAYS?: string;
  AccessBridgeDB: D1Database;
}

export { BackgroundTaskRunPruningTask };
