import { AbstractScheduledTask } from '@rexezuge/runtime';
import type { ScheduledTaskEnv, TaskRunRecorder } from '@rexezuge/runtime';
import { SubrequestCounter, UNMETERED_SUBREQUESTS } from '@rexezuge/shared';
import type { SubrequestMeter } from '@rexezuge/shared';
import { BackgroundTaskRunDAO } from '@aws-access-bridge/backend-data/dao';

/**
 * The environment every scheduled task receives.
 *
 * `D1Database` rather than the base's structural `DB?`, because this
 * repository's binding is named and `createRunRecorder` needs it to construct
 * the DAO. A wider type here would only push the same cast down one level.
 */
interface IEnv extends ScheduledTaskEnv {
  AccessBridgeDB: D1Database;
}

/**
 * Bind the kit's run-record port to this repository's table.
 *
 * The port rather than the DAO, because `@rexezuge/runtime` is the DI and
 * platform layer and has no D1 dependency — inverting the package graph to let a
 * task base know about a `background_task_runs` table is how seven copies in this
 * family each ended up importing a DAO into the base class.
 *
 * `applicationId` is accepted and ignored: this repository's run records are per
 * task type, and `ApplicationRunHandle` is not used yet. Dropping the field
 * silently would have left a caller believing it had scoped a run when it had not.
 */
function createTaskRunRecorder(database: D1Database): TaskRunRecorder {
  const dao = new BackgroundTaskRunDAO(database);
  return {
    startRun: ({ taskType }): Promise<string> => dao.startRun({ taskType }),
    succeedRun: (runId, result): Promise<void> => dao.succeedRun(runId, result),
    failRun: (runId, errorMessage, partial): Promise<void> => dao.failRun(runId, errorMessage, partial),
    skipRun: (runId, reason): Promise<void> => dao.skipRun(runId, reason),
  };
}

/**
 * The base every scheduled task extends.
 *
 * The template is `@rexezuge/runtime`'s `AbstractScheduledTask`, converged from
 * the seven copies in this family including the one that used to be
 * `IScheduledTask.ts` in this directory. It owns the run bookkeeping, the
 * try/catch that writes `failRun` **before** the failure escapes, and the
 * Factory-Method seam a test substitutes.
 *
 * ### The one override, and what removes it
 *
 * `createRunRecorder` takes no argument, because a task is constructed before the
 * platform has handed over `env`. The recorder is therefore built from the `env`
 * the current `handle` call received, which is why `handle` stashes it first.
 * The kit change that removes this override is to pass `env` to
 * `createRunRecorder`, which every consumer of this pattern needs and none of them
 * can express today.
 *
 * The re-throw that the 1.7.2 template lacked — and that this repository's copy
 * had, and lost in the convergence — arrived in the kit as the template's own
 * default, so there is no override and no flag for it here. `CronTasksWorker`
 * still answers `{status: 'failed'}` for a cron that threw.
 *
 * ### Why the counter is per-invocation
 *
 * A fresh `SubrequestCounter` per `handle` call rather than per task instance, so
 * a task that is constructed but never run does not carry a stale tally, and so
 * the count describes the invocation rather than the object.
 */
abstract class CronTask<TEnv extends IEnv = IEnv> extends AbstractScheduledTask<TEnv> {
  private env: TEnv | null = null;

  private counter: SubrequestMeter = UNMETERED_SUBREQUESTS;

  /**
   * The invocation's subrequest counter.
   *
   * Passed to the DAOs a task constructs, because D1 counts its own statements
   * against the Workers per-invocation ceiling and a DAO that spends one without
   * telling anybody makes every number that budgets work wrong. It has **no
   * symptom** until the platform terminates the invocation — at which point the
   * rows are right and the suite is green.
   */
  protected get meter(): SubrequestMeter {
    return this.counter;
  }

  /**
   * Refuse work that cannot fit, naming what was refused.
   *
   * Declared here rather than delegating to the kit's `assertSubrequestBudget`
   * because that one speaks for "this request" and says "send fewer items at once",
   * neither of which is true of a cron sweep — the accounts stay due, so the
   * honest answer is which sweep ran out and how many it left.
   */
  protected assertSubrequestBudget(operations: number, what: string): void {
    if (operations > this.counter.remaining) {
      throw new Error(
        `${what} needs ${operations} database operations and this invocation has ${this.counter.remaining} left. The accounts stay due for the next cron.`,
      );
    }
  }

  /**
   * The D1 binding from the current invocation, or `null` when there is none.
   *
   * Read lazily because a task that does not report never constructs a recorder,
   * so there is nothing to look up: the base asks for one only when
   * `getTaskType()` has opted in.
   */
  protected override createRunRecorder(): TaskRunRecorder | null {
    const database = this.env?.AccessBridgeDB;
    return database ? createTaskRunRecorder(database) : null;
  }

  /**
   * The ambient platform types, not the kit's structural ones.
   *
   * `ScheduledController` and `ExecutionContext` are globals in a Wrangler
   * project, and the real ones carry `retry()`/`waitUntil()` that the structural
   * shapes do not. `CollectionWorkflow` hands both to a step callback, so a
   * narrower parameter here would be a cast at the call site instead.
   *
   * `env` keeps the template's `TEnv` rather than widening to the ambient `Env`:
   * widening it here would make the override incompatible with the base, and
   * `CollectionWorkflow` is the one place where the ambient env meets a task's
   * declared bindings — so the cast belongs there, once, where it can be read.
   */
  public override async handle(event: ScheduledController, env: TEnv, ctx: ExecutionContext): Promise<void> {
    this.env = env;
    this.counter = new SubrequestCounter();
    await super.handle(event, env, ctx);
  }
}

export { CronTask };
export type { IEnv };
export { type TaskRunSummary } from '@rexezuge/runtime';
