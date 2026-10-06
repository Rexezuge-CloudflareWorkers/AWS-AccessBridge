import { describe, it, expect } from 'vitest';
import { AbstractEntrypointWorker } from '@aws-access-bridge/backend-runtime/base';

function createEnv(): CloudflareEnv {
  return {} as CloudflareEnv;
}

function createExecutionContext(): ExecutionContext {
  return { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
}

class RecordingWorker extends AbstractEntrypointWorker {
  public readonly requestCalls: string[] = [];
  public readonly scheduledCalls: Array<{ cron: string; scheduledTime: number }> = [];

  protected async onRequest(request: Request): Promise<Response> {
    this.requestCalls.push(request.url);
    return new Response('handled');
  }

  protected async onScheduled(event: ScheduledController): Promise<void> {
    this.scheduledCalls.push({ cron: event.cron, scheduledTime: event.scheduledTime });
  }
}

describe('AbstractEntrypointWorker', () => {
  it('delegates every request to onRequest', async () => {
    const worker = new RecordingWorker();
    const response = await worker.fetch(new Request('https://worker.example.com/user/me'), createEnv(), createExecutionContext());
    expect(await response.text()).toBe('handled');
    expect(worker.requestCalls).toHaveLength(1);
  });

  /**
   * The old `/__scheduled` intercept ran ahead of `onRequest`, which meant the
   * HTTP surface could drive the privileged cron pipeline — a second, separately
   * authenticated path into code that otherwise only Cloudflare's
   * `triggers.crons` can reach. There is no longer a trigger path: every request
   * is an ordinary one.
   */
  it.each(['/__scheduled', '/__scheduled/extra', '/__scheduled?cron=*%2F10+*+*+*+*'])('routes %s to onRequest rather than the scheduler', async (path) => {
    const worker = new RecordingWorker();
    const response = await worker.fetch(new Request(`https://worker.example.com${path}`, { method: 'POST' }), createEnv(), createExecutionContext());
    expect(await response.text()).toBe('handled');
    expect(worker.requestCalls).toHaveLength(1);
    // The scheduler is reachable only through `scheduled()`, never `fetch()`.
    expect(worker.scheduledCalls).toHaveLength(0);
  });

  it('turns an unhandled onRequest error into a 500 instead of throwing', async () => {
    class BoomWorker extends AbstractEntrypointWorker {
      protected async onRequest(): Promise<Response> {
        throw new Error('kaput');
      }
      protected async onScheduled(): Promise<void> {
        /*
        unused
        */
      }
    }
    const response = await new BoomWorker().fetch(new Request('https://worker.example.com/'), createEnv(), createExecutionContext());
    expect(response.status).toBe(500);
  });

  it('runs the scheduled pipeline from scheduled(), passing the event through', async () => {
    const worker = new RecordingWorker();
    await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: 42, noRetry: () => undefined }, createEnv(), createExecutionContext());
    expect(worker.scheduledCalls).toEqual([{ cron: '*/10 * * * *', scheduledTime: 42 }]);
  });

  it('swallows errors from the scheduled entrypoint', async () => {
    class FailingScheduleWorker extends AbstractEntrypointWorker {
      protected async onRequest(): Promise<Response> {
        return new Response('handled');
      }
      protected async onScheduled(): Promise<void> {
        throw new Error('kaput');
      }
    }
    await expect(
      new FailingScheduleWorker().scheduled({ cron: '', scheduledTime: 0, noRetry: () => undefined }, createEnv(), createExecutionContext()),
    ).resolves.toBeUndefined();
  });
});