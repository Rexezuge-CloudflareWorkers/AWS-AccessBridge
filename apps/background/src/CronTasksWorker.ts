import { AbstractDurableObjectWorker } from '@aws-access-bridge/backend-runtime/base';
import { tasksForPhase } from '@aws-access-bridge/background/scheduled';

const CRON_TASKS_RUN_PATH: string = '/run';

interface CronTasksRunRequest {
  cron?: unknown;
  scheduledTime?: unknown;
}

class CronTasksWorker extends AbstractDurableObjectWorker {
  protected currentRun: Promise<void> | undefined;

  protected async onRequest(request: Request): Promise<Response> {
    const url: URL = new URL(request.url);
    if (url.pathname !== CRON_TASKS_RUN_PATH) {
      return Response.json({ error: 'Not Found' }, { status: 404 });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
    }
    if (this.currentRun) {
      return Response.json({ status: 'already_running' }, { status: 202 });
    }

    const run: Promise<void> = this.runScheduledTaskRequest(request);
    this.currentRun = run;

    try {
      await run;
      return Response.json({ status: 'completed' });
    } catch (err: unknown) {
      console.error('Cron task run failed:', err);
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
    } catch (_err: unknown) {
      console.debug(_err);
      return {};
    }
  }

  protected async runScheduledTasks(event: ScheduledController): Promise<void> {
    const ctx: ExecutionContext = this.createExecutionContext();
    await Promise.all(tasksForPhase(1).map((task) => task.handle(event, this.env, ctx)));
    await Promise.all(tasksForPhase(2).map((task) => task.handle(event, this.env, ctx)));
  }
}

export { CronTasksWorker };
