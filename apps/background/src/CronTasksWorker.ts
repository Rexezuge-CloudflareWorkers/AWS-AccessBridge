import { AbstractDurableObjectWorker } from '@aws-access-bridge/backend-runtime/base';
import { tasksForPhase } from '@aws-access-bridge/background/scheduled';

import { log, toErrorMessage } from '@aws-access-bridge/shared/utils';
const CRON_TASKS_RUN_PATH: string = '/run';

/**
 * How long an in-flight run may hold the `already_running` guard.
 *
 * The guard is in-memory, so a task whose AWS call never settles would make every
 * later tick answer 202 until the Durable Object is evicted — and the pipeline
 * (credential refresh, retention, cost and inventory collection) would silently
 * stop. Fifteen minutes is generous against the 10-minute cron interval: a
 * healthy run finishes well inside one tick, so only a run that has outlived
 * more than one full tick is treated as wedged. The per-call fetch timeout
 * (`DEFAULT_AWS_FETCH_TIMEOUT_MS`) is what normally keeps a run from getting
 * here; this is the backstop for the hang nothing else bounds.
 */
const MAX_RUN_AGE_MS: number = 15 * 60 * 1000;

interface ActiveRun {
  promise: Promise<void>;
  startedAt: number;
}

interface CronTasksRunRequest {
  cron?: unknown;
  scheduledTime?: unknown;
}

class CronTasksWorker extends AbstractDurableObjectWorker {
  protected currentRun: ActiveRun | undefined;

  protected async onRequest(request: Request): Promise<Response> {
    const url: URL = new URL(request.url);
    if (url.pathname !== CRON_TASKS_RUN_PATH) {
      return Response.json({ error: 'Not Found' }, { status: 404 });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
    }
    if (this.currentRun) {
      const ageMs: number = Date.now() - this.currentRun.startedAt;
      if (ageMs < MAX_RUN_AGE_MS) {
        return Response.json({ status: 'already_running' }, { status: 202 });
      }
      // The old promise is abandoned, not cancelled: nothing can cancel a hung
      // await. Its `finally` below compares identity, so when (if) it settles it
      // cannot clear the guard of the run that replaced it.
      log.warn('Expiring a cron run that outlived the maximum age; starting a new one:', { ageMs, maxAgeMs: MAX_RUN_AGE_MS });
      this.currentRun = undefined;
    }

    const run: ActiveRun = { promise: this.runScheduledTaskRequest(request), startedAt: Date.now() };
    this.currentRun = run;

    try {
      await run.promise;
      return Response.json({ status: 'completed' });
    } catch (err: unknown) {
      log.error('Cron task run failed:', { error: err });
      return Response.json({ status: 'failed' }, { status: 500 });
    } finally {
      if (this.currentRun === run) {
        this.currentRun = undefined;
      }
    }
  }

  protected async runScheduledTaskRequest(request: Request): Promise<void> {
    const event: ScheduledController = await this.createScheduledController(request);
    await this.runScheduledTasks(event);
  }

  protected async createScheduledController(request: Request): Promise<ScheduledController> {
    const payload: CronTasksRunRequest = await this.readRunRequest(request);
    return {
      cron: typeof payload.cron === 'string' ? payload.cron : '',
      scheduledTime: typeof payload.scheduledTime === 'number' ? payload.scheduledTime : Date.now(),
      noRetry: (): void => undefined,
    };
  }

  protected async readRunRequest(request: Request): Promise<CronTasksRunRequest> {
    try {
      return await request.json();
    } catch (error: unknown) {
      // `warn`, not `debug`: a malformed body means the *trigger* was wrong, which
      // is exactly what someone needs to see in a production log tail. A debug
      // line is invisible there, and the empty fallback still lets the run proceed
      // with a synthesized cron expression — so the failure has to be visible.
      log.warn('Cron trigger body was not valid JSON; falling back to defaults:', { error: toErrorMessage(error) });
      return {};
    }
  }

  protected async runScheduledTasks(event: ScheduledController): Promise<void> {
    const ctx: ExecutionContext = this.createExecutionContext();
    // `allSettled` so one failing task neither aborts its phase-mates nor hides
    // behind a bare `Promise.all` rejection; the aggregate is re-thrown below so
    // the run is still reported as failed.
    const collectionWorkflow: Workflow | undefined = (this.env as unknown as { COLLECTION_WORKFLOW?: Workflow }).COLLECTION_WORKFLOW;
    if (collectionWorkflow) {
      // The collection sweeps are the durable part of the cron. Each tick starts
      // one instance; the workflow runs the cost and inventory steps with
      // per-step retries instead of walking them inside this DO request, where a
      // wedged AWS call would hold the `already_running` guard.
      const instance = await collectionWorkflow.create({ params: { cron: event.cron, scheduledTime: event.scheduledTime } });
      log.info('Started collection workflow instance', { id: instance.id });
    }
    const inline = collectionWorkflow ? [tasksForPhase(1), tasksForPhase(2, { collections: false })] : [tasksForPhase(1), tasksForPhase(2)];
    const phases = inline;
    const failures: string[] = [];
    for (const tasks of phases) {
      const settled = await Promise.allSettled(tasks.map((task) => task.handle(event, this.env, ctx)));
      for (const result of settled) {
        if (result.status === 'rejected') {
          failures.push(result.reason instanceof Error ? `${result.reason.name}: ${result.reason.message}` : toErrorMessage(result.reason));
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} scheduled task(s) failed: ${failures.join('; ')}`);
    }
  }
}

export { CronTasksWorker, MAX_RUN_AGE_MS };
