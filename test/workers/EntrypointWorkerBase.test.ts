import { describe, it, expect, vi } from 'vitest';
import { AbstractEntrypointWorker } from '@aws-access-bridge/backend-runtime/base';
import { SCHEDULED_TRIGGER_PATH } from '@aws-access-bridge/backend-runtime/constants';

function createExecutionContext(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function createEnv(): CloudflareEnv {
  return {} as CloudflareEnv;
}

class RecordingWorker extends AbstractEntrypointWorker {
  public readonly scheduledCalls: Array<{ cron: string; scheduledTime: number }> = [];
  public readonly requestCalls: Request[] = [];

  protected async onRequest(request: Request): Promise<Response> {
    this.requestCalls.push(request);
    return new Response('handled');
  }

  protected async onScheduled(event: ScheduledController): Promise<void> {
    this.scheduledCalls.push({ cron: event.cron, scheduledTime: event.scheduledTime });
  }
}

class OptedInWorker extends RecordingWorker {
  protected authorizeScheduledTrigger(): undefined {
    return undefined;
  }
}

describe('AbstractEntrypointWorker', () => {
  it('delegates ordinary requests to onRequest', async () => {
    const worker = new RecordingWorker();
    const response = await worker.fetch(new Request('https://worker.example.com/user/me'), createEnv(), createExecutionContext());
    expect(await response.text()).toBe('handled');
    expect(worker.requestCalls).toHaveLength(1);
  });

  it('turns an unhandled onRequest error into a 500 instead of throwing', async () => {
    class BoomWorker extends AbstractEntrypointWorker {
      protected async onRequest(): Promise<Response> {
        throw new Error('kaput');
      }
      protected async onScheduled(): Promise<void> {
        /* unused */
      }
    }
    const response = await new BoomWorker().fetch(new Request('https://worker.example.com/'), createEnv(), createExecutionContext());
    expect(response.status).toBe(500);
  });

  it('denies the scheduled trigger by default', async () => {
    // Fail closed: a worker that does not opt in must not expose a privileged
    // trigger, even though the intercept runs ahead of any route middleware.
    const worker = new RecordingWorker();
    const response = await worker.fetch(new Request(`https://worker.example.com${SCHEDULED_TRIGGER_PATH}`, { method: 'POST' }), createEnv(), createExecutionContext());
    expect(response.status).toBe(404);
    expect(worker.scheduledCalls).toHaveLength(0);
  });

  it('runs the pipeline when a subclass opts in, passing the cron expression through', async () => {
    const worker = new OptedInWorker();
    const before = Date.now();
    const response = await worker.fetch(
      new Request(`https://worker.example.com${SCHEDULED_TRIGGER_PATH}?cron=*%2F10+*+*+*+*`, { method: 'POST' }),
      createEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(204);
    expect(worker.scheduledCalls).toHaveLength(1);
    expect(worker.scheduledCalls[0].cron).toBe('*/10 * * * *');
    expect(worker.scheduledCalls[0].scheduledTime).toBeGreaterThanOrEqual(before);
  });

  it('defaults the cron expression to an empty string', async () => {
    const worker = new OptedInWorker();
    await worker.fetch(new Request(`https://worker.example.com${SCHEDULED_TRIGGER_PATH}`, { method: 'POST' }), createEnv(), createExecutionContext());
    expect(worker.scheduledCalls[0].cron).toBe('');
  });

  it('returns a denial response verbatim', async () => {
    class CustomDenyWorker extends AbstractEntrypointWorker {
      protected authorizeScheduledTrigger(): Response {
        return new Response('nope', { status: 403 });
      }
      protected async onRequest(): Promise<Response> {
        return new Response('handled');
      }
      protected async onScheduled(): Promise<void> {
        /* unused */
      }
    }
    const worker = new CustomDenyWorker();
    const response = await worker.fetch(new Request(`https://worker.example.com${SCHEDULED_TRIGGER_PATH}`), createEnv(), createExecutionContext());
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('nope');
  });

  it('does not treat a similarly-named path as the trigger', async () => {
    const worker = new OptedInWorker();
    const response = await worker.fetch(new Request('https://worker.example.com/__scheduled/extra'), createEnv(), createExecutionContext());
    expect(await response.text()).toBe('handled');
    expect(worker.scheduledCalls).toHaveLength(0);
  });

  it('swallows errors from the scheduled entrypoint', async () => {
    class FailingScheduleWorker extends AbstractEntrypointWorker {
      protected async onRequest(): Promise<Response> {
        return new Response('handled');
      }
      protected async onScheduled(): Promise<void> {
        throw new Error('cron exploded');
      }
    }
    // A real cron trigger has no caller to receive a rejection, so `scheduled`
    // must not propagate.
    await expect(
      new FailingScheduleWorker().scheduled({ cron: '', scheduledTime: 0, noRetry: () => undefined }, createEnv(), createExecutionContext()),
    ).resolves.toBeUndefined();
  });
});
