# AWS-AccessBridge — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`.

- `CronTasksWorker.ts` — DO serializing cron in two phases via `scheduled/TaskRegistry.ts` (`tasksForPhase(1|2)`; add tasks there, not in the worker):
  - Phase 1 (parallel): `CredentialCacheRefreshTask` (user-facing freshness first)
  - Phase 2 (parallel): `AuditLogCleanupTask`, `BackgroundTaskRunPruningTask`, `CostDataCollectionTask`, `ResourceInventoryCollectionTask`
- Shared scheduled bases: `IScheduledTask` (Template Method + automatic `background_task_runs` tracking for tasks overriding `getTaskType()` and returning a `TaskRunSummary`), `AbstractPruningTask` (Template Method for retention pruning: `getRetentionDays` + `pruneBatch` abstract, cutoff + batched loop in base; both cleanup tasks extend it).
- `scheduled/TaskRegistry.ts` — composite phase registry (`CRON_TASK_DEFINITIONS`); append a definition to add a task.

## Background Task Visibility

`GET /user/admin/maintenance/task-runs` (`BackgroundTaskRunDAO.listRuns`, optional `taskType`/`status`/`limit`) exposes cron run history. Retention: `BACKGROUND_TASK_RUN_RETENTION_DAYS` (default 30, `ConfigurationDefaults.ts`), pruned by `BackgroundTaskRunPruningTask`.
