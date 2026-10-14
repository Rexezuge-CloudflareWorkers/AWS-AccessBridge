import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { CostDataCollectionTask } from './scheduled/CostDataCollectionTask';
import { ResourceInventoryCollectionTask } from './scheduled/ResourceInventoryCollectionTask';
import type { CollectionTaskEnv } from './scheduled/AbstractCollectionTask';
import type { CronTask } from './scheduled/CronTask';

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

/**
 * The two long collection sweeps, and the durable-object-free path they run under.
 *
 * Typed to the shared `CollectionTaskEnv` rather than to either concrete task,
 * because `step.do` calls `make().handle(...)` on a union of the two and an
 * inferred signature would demand the *intersection* of their env types.
 */
const COLLECTION_STEPS: readonly { name: string; make: () => CronTask<CollectionTaskEnv> }[] = [
  { name: 'cost-data-collection', make: (): CostDataCollectionTask => new CostDataCollectionTask() },
  { name: 'resource-inventory-collection', make: (): ResourceInventoryCollectionTask => new ResourceInventoryCollectionTask() },
];

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
          // `Env` does not satisfy `CollectionTaskEnv` for one reason only: the
          // collection env declares an index signature, and an interface never
          // gains an implicit one. Every binding it names is declared on the
          // generated `Env`, so this narrows nothing and asserts nothing — it
          // converts between two descriptions of the same object. The `unknown`
          // hop is what says so to the checker, which otherwise has no reason to
          // believe two descriptions of one object are compatible.
          await make().handle(controller, env as unknown as CollectionTaskEnv, ctx);
          return null;
        },
      );
    }
    return results;
  }
}

export { CollectionWorkflow };
export type { CollectionWorkflowParams };
