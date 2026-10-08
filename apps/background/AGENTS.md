# AWS-AccessBridge — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`. Workspace and layer rules: [`../../docs/agents/repo/AGENTS.md`](../../docs/agents/repo/AGENTS.md).

`src/index.ts` re-exports `CronTasksWorker` and `CollectionWorkflow`; `apps/api/src/index.ts`
re-exports both again — the DO binding and the `workflows` binding. There is **no** HTTP trigger for the cron pipeline — `AbstractEntrypointWorker` routes every
request to the Hono app — so the scheduled path is reachable only from Cloudflare's
`triggers.crons`.

## The two phases

`CronTasksWorker` serializes the cron into two phases via `scheduled/TaskRegistry.ts`. Adding a task
means appending a definition to `CRON_TASK_DEFINITIONS`, not editing the worker.

| Phase | Task                              | Job                                                                                                                   |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | `CredentialCacheRefreshTask`      | pre-assume the _intermediate_ hops of each due chain into KV; bump `last_cached_at` once per principal after the walk |
| 2     | `AuditLogCleanupTask`             | prune `audit_log` past `AUDIT_LOG_RETENTION_DAYS`                                                                     |
| 2     | `BackgroundTaskRunPruningTask`    | prune `background_task_runs` past `BACKGROUND_TASK_RUN_RETENTION_DAYS`                                                |
| 2     | `CostDataCollectionTask`          | Cost Explorer, 3 accounts/invocation — **a step of `CollectionWorkflow`**                                             |
| 2     | `ResourceInventoryCollectionTask` | resource sweep, 2 accounts/invocation — **a step of `CollectionWorkflow`**                                            |

User-facing freshness first: refreshing the credential cache is what makes the next interactive
assume-role fast, and running it before the collection tasks means those tasks hit a warm chain.

## Collection runs as a Workflow, not inside the DO request

`CronTasksWorker` starts one `COLLECTION_WORKFLOW` instance per tick and runs the collection tasks as
named steps inside it; the credential refresh and the two pruning tasks stay inline. The reason is
the one the fetch timeout cannot fully solve: a hung AWS call inside the DO request held the
in-memory `already_running` guard, so every later tick answered 202 and the whole pipeline stopped
silently. A workflow step is bounded by the platform, is retried once on a transient fault, and its
result is cached under its name.

`TaskRegistry`'s definitions carry `collection: true` for the two sweeps, and `tasksForPhase(2,
{ collections: false })` is what the DO runs when the binding is present. **With no binding, the same
tasks run inline exactly as before** — the workflow is an optimization and a resilience change, not
a new requirement.

The `already_running` guard also expires: `MAX_RUN_AGE_MS` abandons a run that has outlived more
than one full tick interval, and the DO logs a `warn` on every 202 skip so a stuck pipeline is
visible in a log tail rather than inferred from missing data.

## The three template bases

| Base                     | Abstract members                                                                                            | Extended by                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `IScheduledTask`         | `handleScheduledTask`                                                                                       | every task; also writes `background_task_runs` for any task overriding `getTaskType()`; every task returns a `TaskRunSummary` |
| `AbstractPruningTask`    | `getRetentionDays`, `pruneBatch`                                                                            | `AuditLogCleanupTask`, `BackgroundTaskRunPruningTask`                                                                         |
| `AbstractCollectionTask` | `collectionType`, `maxAccountsPerCollection`, `collectionIntervalHours`, `sessionName`, `collectForAccount` | `CostDataCollectionTask`, `ResourceInventoryCollectionTask`                                                                   |

`IScheduledTask.createTaskRunDAO` is a Factory-Method seam so a test can substitute the run recorder.

`AbstractCollectionTask` stamps `last_attempt_at` on every attempt (success, empty result,
failure) and advances `last_collected_at` only when `collectForAccount` reported data — so a
failing or empty account is retried on the next interval, not the next tick, and cannot
starve the healthy accounts behind it in the batch. Ordering is on the attempt clock; migration
`0033` added the column and backfilled it from `last_collected_at`.

## Services come from the composition root, with a fresh scope per run

Every task resolves its collaborators through `createRequestScope(env).get(Tokens.X)` — never
`new XService(env)`. The tokens actually used are `CredentialChainService` and `StsService` (phase 1),
`CostExplorerService` (cost collection) and `CollectorRegistry` (inventory collection).

**A fresh scope per run, not `getRequestScope`.** A Durable Object's `env` is stable for the object's
lifetime, so a cached scope would pin the memoized encryption keys in `composition/encryptionKeys.ts`
and the cron would keep using the old key after a rotation. The request-path reason for keying on
the Hono context instead of `env` does not apply here — there is no context.

Retention and batch tunables are read through `ConfigurationManager` namespaces
(`credential`, `costs`, `resource`, `audit`, `processing`), never `parseInt(env.X || DEFAULT)`
inline. See [`../../docs/agents/runtime/AGENTS.md`](../../docs/agents/runtime/AGENTS.md) for the
variable table.

Per-account failures are isolated: one unresolvable chain, one denied account, or one malformed AWS
body must not abort the remaining principals or accounts in the batch. Each is caught, counted in
`itemsFailed`, and the run still reports.

## Visibility

`GET /user/admin/maintenance/task-runs` exposes cron history via `BackgroundTaskRunDAO.listRuns`,
with optional `taskType`, `status` and `limit`. `MaintenanceService.listTaskRuns` clamps the limit —
`Pagination` lives in `backend-runtime` (Layer 1), so the clamp belongs in the Layer 3 service rather
than in its Layer 2 DAO. Retention is `BACKGROUND_TASK_RUN_RETENTION_DAYS` (default 30), pruned by
`BackgroundTaskRunPruningTask` in `PRUNE_BATCH_SIZE` chunks.

Frontend: the `MaintenanceTab` admin tab.
