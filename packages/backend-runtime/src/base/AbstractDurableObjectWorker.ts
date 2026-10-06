import { DurableObject } from 'cloudflare:workers';

import { log } from '@aws-access-bridge/shared/utils';

abstract class AbstractDurableObjectWorker extends DurableObject<CloudflareEnv> {
  protected printExecId(): string {
    const execId: string = crypto.randomUUID();
    // `info`, not `log`: fires on every inbound Durable Object request, so at this
    // rate it is noise rather than a diagnostic.
    log.info('Durable Object execution started', { executionId: execId });
    return execId;
  }

  public async fetch(request: Request): Promise<Response> {
    this.printExecId();
    try {
      return await this.onRequest(request);
    } catch (err: unknown) {
      log.error('Unhandled error in durable object fetch()', { error: err });
      return Response.json({ error: 'Internal Error' }, { status: 500 });
    }
  }

  protected createExecutionContext(): ExecutionContext {
    return {
      waitUntil: (promise: Promise<unknown>): void => this.ctx.waitUntil(promise),
      passThroughOnException: (): void => undefined,
    } as unknown as ExecutionContext;
  }

  protected abstract onRequest(request: Request): Promise<Response>;
}

export { AbstractDurableObjectWorker };