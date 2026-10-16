# AWS-AccessBridge — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`. Workspace and layer rules: [`../../docs/agents/repo/AGENTS.md`](../../docs/agents/repo/AGENTS.md).

`src/index.ts` re-exports `CronTasksWorker` and `CollectionWorkflow`; `apps/api/src/index.ts` re-exports both again — the DO binding and the `workflows` binding. There is **no** HTTP trigger for the cron pipeline — `AbstractEntrypointWorker` routes every request to the Hono app — so the scheduled path is reachable only from Cloudflare's `triggers.crons`.

## The two phases

`CronTasksWorker` serializes the cron into two phases via `scheduled/TaskRegistry.ts`. Adding a task means appending a definition to `CRON_TASK_DEFINITIONS`, not editing the worker.

| Phase | Task                              | Job                                                                                                                   |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | `CredentialCacheRefreshTask`      | pre-assume the _intermediate_ hops of each due chain into KV; bump `last_cached_at` once per principal after the walk |
| 2     | `AuditLogCleanupTask`             | prune `audit_log` past `AUDIT_LOG_RETENTION_DAYS`                                                                     |
| 2     | `BackgroundTaskRunPruningTask`    | prune `background_task_runs` past `BACKGROUND_TASK_RUN_RETENTION_DAYS`                                                |
| 2     | `CostDataCollectionTask`          | Cost Explorer, 3 accounts/invocation — **a step of `CollectionWorkflow`**                                             |
| 2     | `ResourceInventoryCollectionTask` | resource sweep, 2 accounts/invocation — **a step of `CollectionWorkflow`**                                            |

Refreshing the credential cache is what makes the next interactive assume-role fast, and it stays inline in the DO. The collection steps no longer wait on it: `CronTasksWorker` starts the workflow instance _before_ the inline phases run, so the refresh and the sweeps run in parallel.

## Collection runs as a Workflow, not inside the DO request

`CronTasksWorker` starts one `COLLECTION_WORKFLOW` instance per tick and runs the collection tasks as named steps inside it; the credential refresh and the two pruning tasks stay inline. A hung AWS call inside the DO request used to hold the in-memory `already_running` guard, so every later tick answered 202 and the whole pipeline stopped silently. A workflow step is bounded by the platform, is retried once on a transient fault, and its result is cached under its name.

**The run record is written by the step, not by the DO.** Each step calls `task.handle(...)`, and that is what writes `background_task_runs` — so a collection failure still shows up in `GET /user/admin/maintenance/task-runs` even though the DO answered `completed` the moment it handed the work over. That is also why a step must throw rather than swallow: the DO's own response no longer reports the collection outcome.

`TaskRegistry`'s definitions carry `collection: true` for the two sweeps, and `tasksForPhase(2, { collections: false })` is what the DO runs when the binding is present. **With no binding, the same tasks run inline exactly as before** — the workflow is an optimization and a resilience change, not a new requirement.

The `already_running` guard also expires: `MAX_RUN_AGE_MS` abandons a run that has outlived more than one full tick interval, and the API worker's `onScheduled` logs a `warn` on every 202 response, so a stuck pipeline is visible in a log tail rather than inferred from missing data.

## The three template bases

| Base                     | Abstract members                                                                                            | Extended by                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CronTask`               | `handleScheduledTask`                                                                                       | every task; also writes `background_task_runs` for any task overriding `getTaskType()`; every task returns a `TaskRunSummary` |
| `AbstractPruningTask`    | `getRetentionDays`, `pruneBatch`                                                                            | `AuditLogCleanupTask`, `BackgroundTaskRunPruningTask`                                                                         |
| `AbstractCollectionTask` | `collectionType`, `maxAccountsPerCollection`, `collectionIntervalHours`, `sessionName`, `collectForAccount` | `CostDataCollectionTask`, `ResourceInventoryCollectionTask`                                                                   |

`CronTask` is a thin subclass of `@rexezuge/runtime`'s `AbstractScheduledTask` — it does three things and no more.

### It re-throws, because the template does

The template records `failRun` **and re-raises the original error**: the run row already says why by the time `CronTasksWorker` sees the rejection, so the cron answers `{status: 'failed'}` instead of `completed`. `test/tasks/ScheduledTasks.test.ts` asserts `rejects.toThrow('kaput')` — the original message, not a wrapper.

### It owns a `SubrequestCounter` per invocation

A fresh counter per `handle` call, not per task instance: a task constructed but never run should not carry a stale tally. It is reachable as `this.meter` for the DAOs a task builds, and passing it matters — D1 counts its own statements against the per-invocation ceiling, and a DAO that spends one without telling anybody makes every number that budgets work wrong. See [`packages/backend-data/AGENTS.md`](../../packages/backend-data/AGENTS.md).

`CronTask.assertSubrequestBudget(operations, what)` refuses a whole sweep that cannot fit, naming what was refused rather than delegating to the kit's request-shaped phrasing ("send fewer items at once"), because a cron sweep's accounts stay due — the honest answer is _which sweep ran out and how many it left_. `AbstractCollectionTask` calls it with `principalArns.length * STATEMENTS_PER_ACCOUNT`.

### `createRunRecorder` is the Factory-Method seam

A test substitutes the run recorder here. The base asks for one only when `getTaskType()` has opted in, so a task that does not report never constructs a recorder.

`AbstractCollectionTask` stamps `last_attempt_at` on every attempt — success, empty result, or failure — and advances `last_collected_at` only when `collectForAccount` reported data, so a failing or empty account is retried on the next interval rather than the next tick and cannot starve the healthy accounts behind it. One exception: a D1 daily-write-limit pause stops the sweep without stamping, so the remaining accounts stay due rather than burning their attempt clocks past the reset. Ordering is on the attempt clock; migration `0033` added the column and backfilled it from `last_collected_at`.

## Services come from the composition root, with a fresh scope per run

Every task resolves its collaborators through `createRequestScope(env).get(Tokens.X)` — never `new XService(env)`. The tokens actually used are `CredentialChainService` and `StsService` (phase 1), `CostExplorerService` (cost collection) and `CollectorRegistry` (inventory collection).

**A fresh scope per run, not `getRequestScope`.** A Durable Object's `env` is stable for the object's lifetime, so a cached scope would pin the memoized encryption keys in `composition/encryptionKeys.ts` and the cron would keep using the old key after a rotation; the request-path reason for keying on the Hono context does not apply here, because there is no context.

Retention and batch tunables are read through `ConfigurationManager` namespaces (`credential`, `costs`, `resource`, `audit`, `processing`), never `parseInt(env.X || DEFAULT)` inline. See [`../../docs/agents/runtime/AGENTS.md`](../../docs/agents/runtime/AGENTS.md) for the variable table.

Per-account failures are isolated: one unresolvable chain, one denied account, or one malformed AWS body must not abort the remaining principals or accounts. Each is caught, counted in `itemsFailed`, and the run still reports.

## Visibility

`GET /user/admin/maintenance/task-runs` exposes cron history via `BackgroundTaskRunDAO.listRuns`, with optional `taskType`, `status` and `limit`. `MaintenanceService.listTaskRuns` clamps the limit — `Pagination` lives in `backend-runtime`, so the clamp belongs in the `backend-services` service rather than in its `backend-data` DAO. Retention is `BACKGROUND_TASK_RUN_RETENTION_DAYS` (default 30), pruned by `BackgroundTaskRunPruningTask` in `PRUNE_BATCH_SIZE` chunks. Frontend: the `MaintenanceTab` admin tab.
