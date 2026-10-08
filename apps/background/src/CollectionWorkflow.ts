import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { CostDataCollectionTask } from './scheduled/CostDataCollectionTask';
import { ResourceInventoryCollectionTask } from './scheduled/ResourceInventoryCollectionTask';

/**
 * The durable collection pipeline.
 *
 * Each scheduled tick starts one instance; each collection task runs as its own
 * named step. Step names are stable across ticks because the task type is
 * constant, so a step's cached result — or its single retry — is addressable.
 *
 * The `background_task_runs` record is written by the step itself, not by the
 * cron DO: each step calls `task.handle(...)`, so a collection failure still
 * lands in `GET /user/admin/maintenance/task-runs` even though the DO answered
 * `completed` the moment it handed the work over. That is why a failed step
 * throws — the DO's own response no longer reports the collection outcome.
 */
interface CollectionWorkflowParams {
  cron?: string;
  scheduledTime?: number;
}

const COLLECTION_STEPS = [
  { name: 'cost-data-collection', make: (): CostDataCollectionTask => new CostDataCollectionTask() },
  { name: 'resource-inventory-collection', make: (): ResourceInventoryCollectionTask => new ResourceInventoryCollectionTask() },
] as const;

class CollectionWorkflow extends WorkflowEntrypoint<Env, CollectionWorkflowParams> {
  async run(event: WorkflowEvent<CollectionWorkflowParams>, step: WorkflowStep): Promise<Record<string, null>> {
    const controller: ScheduledController = {
      cron: event.payload?.cron ?? '',
      scheduledTime: event.payload?.scheduledTime ?? event.timestamp.getTime(),
      noRetry: (): void => undefined,
    };
    const ctx: ExecutionContext = this.ctx;
    const env: Env = this.env;
    const results: Record<string, null> = {};
    for (const { name, make } of COLLECTION_STEPS) {
      // A collection sweep can legitimately take minutes over regions; ten is
      // generous. Retry once to ride out a transient AWS throttle or 5xx.
      results[name] = await step.do(
        name,
        { timeout: '10 minutes', retries: { limit: 1, delay: '15 seconds' } },
        async (): Promise<null> => {
          await make().handle(controller, env, ctx);
          return null;
        },
      );
    }
    return results;
  }
}

export { CollectionWorkflow };
export type { CollectionWorkflowParams };
