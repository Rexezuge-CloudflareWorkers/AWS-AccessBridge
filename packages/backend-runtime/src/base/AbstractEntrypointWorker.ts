import { SCHEDULED_TRIGGER_PATH } from '../constants/ScheduledTrigger';

abstract class AbstractEntrypointWorker {
  protected printExecId(): string {
    const execId: string = crypto.randomUUID();
    console.log('🧭 Worker Execution ID:', execId);
    return execId;
  }

  public async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url: URL = new URL(request.url);
    if (url.pathname === SCHEDULED_TRIGGER_PATH) {
      // Runs before the Hono app, so no route middleware (HMAC, auth, audit)
      // has executed. Without an explicit grant this would let any caller drive
      // the privileged scheduled pipeline, so default to denying.
      const denial: Response | undefined = await this.authorizeScheduledTrigger(request, env);
      if (denial) {
        return denial;
      }
      await this.scheduled(
        {
          cron: url.searchParams.get('cron') || '',
          scheduledTime: Date.now(),
          noRetry: (): void => undefined,
        },
        env,
        ctx,
      );
      return new Response(null, { status: 204 });
    }

    this.printExecId();
    console.log('🎯 Worker triggered by HTTP request');
    try {
      return await this.onRequest(request, env, ctx);
    } catch (err: unknown) {
      console.error('❌ Unhandled error in fetch():', err);
      return new Response('Internal Error', { status: 500 });
    }
  }

  /**
   * Decide whether `request` may trigger the scheduled pipeline on demand.
   *
   * Return a `Response` to deny (it is returned to the caller verbatim) or
   * `undefined` to allow. Denying is the default so a newly added worker cannot
   * accidentally publish a privileged trigger; override to opt in. Overrides
   * are typically async (they authenticate), hence the widened return type.
   *
   * The response should not distinguish "unauthenticated" from "not permitted",
   * to avoid turning this into an identity oracle.
   */
  protected authorizeScheduledTrigger(_request: Request, _env: CloudflareEnv): Response | undefined | Promise<Response | undefined> {
    return new Response('Not Found', { status: 404 });
  }

  public async scheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    this.printExecId();
    console.log('⏭️ Worker triggered by Cron schedule');
    try {
      await this.onScheduled(event, env, ctx);
    } catch (err: unknown) {
      console.error('❌ Unhandled error in scheduled():', err);
    }
  }

  protected abstract onRequest(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response>;

  protected abstract onScheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void>;
}

export { AbstractEntrypointWorker };
