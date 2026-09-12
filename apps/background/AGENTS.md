# AWS-AccessBridge — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`.

- `CronTasksWorker.ts` — DO serializing cron in two phases via `scheduled/TaskRegistry.ts` (`tasksForPhase(1|2)`; add tasks there, not in the worker):
  - Phase 1 (parallel): `CredentialCacheRefreshTask` (user-facing freshness first)
  - Phase 2 (parallel): `AuditLogCleanupTask`, `BackgroundTaskRunPruningTask`, `CostDataCollectionTask`, `ResourceInventoryCollectionTask`
- Shared scheduled bases: `IScheduledTask` (Template Method + automatic `background_task_runs` tracking for tasks overriding `getTaskType()` and returning a `TaskRunSummary`), `AbstractPruningTask` (Template Method for retention pruning: `getRetentionDays` + `pruneBatch` abstract, cutoff + batched loop in base; both cleanup tasks extend it).
- `scheduled/TaskRegistry.ts` — composite phase registry (`CRON_TASK_DEFINITIONS`); append a definition to add a task.
- Tasks compose `backend-services`: `CredentialService` (chain resolution, `resolveLeafCredentials` chain walk), `StsService`, `CostExplorerService`, `CollectorRegistry` (resource fan-out over all registered collectors), `ConfigurationManager` (`credential`/`costs`/`resource`/`audit`/`processing` namespaces — no `parseInt(env.X || DEFAULT)` inline).
- Retention/batch tunables live in `ConfigurationDefaults.ts` and are read via `ConfigurationManager` (`AUDIT_LOG_RETENTION_DAYS`, `BACKGROUND_TASK_RUN_RETENTION_DAYS`, `COST_COLLECTION_INTERVAL_HOURS`, `COST_LOOKBACK_DAYS`, `RESOURCE_COLLECTION_INTERVAL_HOURS`, `NUMBER_OF_CREDENTIALS_TO_REFRESH`, `CREDENTIAL_REFRESH_INTERVAL_MINUTES`).

## Background Task Visibility

`GET /user/admin/maintenance/task-runs` (`BackgroundTaskRunDAO.listRuns`, optional `taskType`/`status`/`limit`) exposes cron run history. Retention: `BACKGROUND_TASK_RUN_RETENTION_DAYS` (default 30, `ConfigurationDefaults.ts`), pruned by `BackgroundTaskRunPruningTask`.
