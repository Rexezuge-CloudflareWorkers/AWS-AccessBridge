abstract class AbstractEntrypointWorker {
  protected printExecId(): string {
    const execId: string = crypto.randomUUID();
    console.log('🧭 Worker Execution ID:', execId);
    return execId;
  }

  public async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url: URL = new URL(request.url);
    if ('/__scheduled' === url.pathname) {
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
