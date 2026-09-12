import { describe, it, expect } from 'vitest';
import { CRON_TASK_DEFINITIONS, tasksForPhase } from '@aws-access-bridge/background/scheduled/TaskRegistry';
import { CredentialCacheRefreshTask } from '@aws-access-bridge/background/scheduled/CredentialCacheRefreshTask';
import { AuditLogCleanupTask } from '@aws-access-bridge/background/scheduled/AuditLogCleanupTask';
import { BackgroundTaskRunPruningTask } from '@aws-access-bridge/background/scheduled/BackgroundTaskRunPruningTask';
import { CostDataCollectionTask } from '@aws-access-bridge/background/scheduled/CostDataCollectionTask';
import { ResourceInventoryCollectionTask } from '@aws-access-bridge/background/scheduled/ResourceInventoryCollectionTask';

describe('TaskRegistry', () => {
  it('registers five tasks across two phases', () => {
    expect(CRON_TASK_DEFINITIONS).toHaveLength(5);
  });

  it('runs only the credential cache refresh in phase 1', () => {
    const tasks = tasksForPhase(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toBeInstanceOf(CredentialCacheRefreshTask);
  });

  it('runs cleanup, pruning, and collection tasks in phase 2', () => {
    const tasks = tasksForPhase(2);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toBeInstanceOf(AuditLogCleanupTask);
    expect(tasks[1]).toBeInstanceOf(BackgroundTaskRunPruningTask);
    expect(tasks[2]).toBeInstanceOf(CostDataCollectionTask);
    expect(tasks[3]).toBeInstanceOf(ResourceInventoryCollectionTask);
  });

  it('creates fresh task instances per call', () => {
    expect(tasksForPhase(1)[0]).not.toBe(tasksForPhase(1)[0]);
  });
});
