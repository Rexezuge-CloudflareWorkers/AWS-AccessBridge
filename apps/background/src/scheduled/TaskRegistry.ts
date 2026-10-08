import { AuditLogCleanupTask } from './AuditLogCleanupTask';
import { BackgroundTaskRunPruningTask } from './BackgroundTaskRunPruningTask';
import { CostDataCollectionTask } from './CostDataCollectionTask';
import { CredentialCacheRefreshTask } from './CredentialCacheRefreshTask';
import { ResourceInventoryCollectionTask } from './ResourceInventoryCollectionTask';
import type { IEnv, IScheduledTask } from './IScheduledTask';

type CronPhase = 1 | 2;

interface TaskDefinition {
  phase: CronPhase;
  make: () => IScheduledTask<IEnv>;
  // The two collection sweeps are the long-running tasks: they walk regions
  // and principals and are the ones most likely to be wedged by a hung
  // network call inside the DO request. `CronTasksWorker` routes exactly those
  // to the durable `CollectionWorkflow` when the binding is present.
  collection?: boolean;
}

// Composite registry for cron phases. Adding a task no longer requires
// editing CronTasksWorker — append a definition here instead.
const CRON_TASK_DEFINITIONS: readonly TaskDefinition[] = [
  { phase: 1, make: () => new CredentialCacheRefreshTask() },
  { phase: 2, make: () => new AuditLogCleanupTask() },
  { phase: 2, make: () => new BackgroundTaskRunPruningTask() },
  { phase: 2, collection: true, make: () => new CostDataCollectionTask() },
  { phase: 2, collection: true, make: () => new ResourceInventoryCollectionTask() },
];

function tasksForPhase(phase: CronPhase, options: { collections?: boolean } = {}): IScheduledTask<IEnv>[] {
  return CRON_TASK_DEFINITIONS.filter((d) => d.phase === phase && (options.collections !== false || !d.collection)).map((d) => d.make());
}

export { CRON_TASK_DEFINITIONS, tasksForPhase };
export type { CronPhase, TaskDefinition };
