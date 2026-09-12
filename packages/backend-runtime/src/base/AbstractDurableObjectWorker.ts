import { DurableObject } from 'cloudflare:workers';

abstract class AbstractDurableObjectWorker extends DurableObject<CloudflareEnv> {
  protected printExecId(): string {
    const execId: string = crypto.randomUUID();
    console.log('Durable Object Execution ID:', execId);
    return execId;
  }

  public async fetch(request: Request): Promise<Response> {
    this.printExecId();
    console.log('Durable Object triggered by HTTP request');
    try {
      return await this.onRequest(request);
    } catch (err: unknown) {
      console.error('Unhandled error in durable object fetch():', err);
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
