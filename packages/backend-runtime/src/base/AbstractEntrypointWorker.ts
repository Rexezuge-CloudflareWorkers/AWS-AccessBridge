import { log } from '@aws-access-bridge/shared/utils';

abstract class AbstractEntrypointWorker {
  protected printExecId(): string {
    const execId: string = crypto.randomUUID();
    // `info`, not `log`: this fires on every request and every cron tick, so at
    // this rate it is noise rather than a diagnostic.
    log.info('Worker execution started', { executionId: execId, trigger: 'http' });
    return execId;
  }

  public async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    this.printExecId();
    try {
      return await this.onRequest(request, env, ctx);
    } catch (err: unknown) {
      log.error('Unhandled error in fetch()', { error: err });
      return new Response('Internal Error', { status: 500 });
    }
  }

  public async scheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    log.info('Worker triggered by cron schedule', { cron: event.cron });
    try {
      await this.onScheduled(event, env, ctx);
    } catch (err: unknown) {
      log.error('Unhandled error in scheduled()', { error: err });
    }
  }

  protected abstract onRequest(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response>;

  protected abstract onScheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void>;
}

export { AbstractEntrypointWorker };