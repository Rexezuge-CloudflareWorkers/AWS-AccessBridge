import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { IScheduledTask } from './IScheduledTask';
import type { IEnv, TaskRunSummary } from './IScheduledTask';

const DEFAULT_PRUNE_BATCH_SIZE: number = 500;

abstract class AbstractPruningTask<TEnv extends IEnv> extends IScheduledTask<TEnv> {
  protected abstract getRetentionDays(env: TEnv): number;

  protected abstract pruneBatch(db: D1Database, cutoffTimestamp: number, batchSize: number): Promise<number>;

  protected getBatchSize(): number {
    return DEFAULT_PRUNE_BATCH_SIZE;
  }

  protected async handleScheduledTask(_event: ScheduledController, env: TEnv, _ctx: ExecutionContext): Promise<TaskRunSummary> {
    const db: D1Database = (env as unknown as { AccessBridgeDB: D1Database }).AccessBridgeDB;
    const retentionDays: number = this.getRetentionDays(env);
    const cutoff: number = TimestampUtil.getCurrentUnixTimestampInSeconds() - retentionDays * 86_400;
    const batchSize: number = this.getBatchSize();
    let totalDeleted: number = 0;
    let deletedInBatch: number = await this.pruneBatch(db, cutoff, batchSize);
    totalDeleted += deletedInBatch;
    while (deletedInBatch >= batchSize) {
      deletedInBatch = await this.pruneBatch(db, cutoff, batchSize);
      totalDeleted += deletedInBatch;
    }
    console.log(`[${this.constructor.name}] Pruned ${totalDeleted} rows older than ${retentionDays} days`);
    return { itemsProcessed: totalDeleted, itemsFailed: 0, summary: `Pruned ${totalDeleted} rows older than ${retentionDays} days` };
  }
}

export { AbstractPruningTask, DEFAULT_PRUNE_BATCH_SIZE };
