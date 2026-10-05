import { beforeEach, describe, expect, it, vi } from 'vitest';

const { taskSpies } = vi.hoisted(() => {
  return {
    taskSpies: {
      credentialCacheRefresh: vi.fn(),
      auditLogCleanup: vi.fn(),
      costDataCollection: vi.fn(),
      resourceInventoryCollection: vi.fn(),
    },
  };
});

vi.mock('@aws-access-bridge/background/scheduled', () => {
  return {
    CredentialCacheRefreshTask: class {
      handle = taskSpies.credentialCacheRefresh;
    },
    AuditLogCleanupTask: class {
      handle = taskSpies.auditLogCleanup;
    },
    CostDataCollectionTask: class {
      handle = taskSpies.costDataCollection;
    },
    ResourceInventoryCollectionTask: class {
      handle = taskSpies.resourceInventoryCollection;
    },
    tasksForPhase: (phase: number): Array<{ handle: (...args: unknown[]) => Promise<void> }> => {
      if (phase === 1) {
        return [{ handle: taskSpies.credentialCacheRefresh as (...args: unknown[]) => Promise<void> }];
      }
      return [
        { handle: taskSpies.auditLogCleanup as (...args: unknown[]) => Promise<void> },
        { handle: taskSpies.costDataCollection as (...args: unknown[]) => Promise<void> },
        { handle: taskSpies.resourceInventoryCollection as (...args: unknown[]) => Promise<void> },
      ];
    },
  };
});

import { CronTasksWorker } from '@aws-access-bridge/background/CronTasksWorker';

function createDurableObjectState(): DurableObjectState {
  return {
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

/**
 * A deliberately minimal environment.
 *
 * The worker's entry point is typed `CloudflareEnv`, which the generator pins to the
 * template's exact values — `POLICY_AUD` is the literal
 * `"you-cloudflare-zero-trust-application-aud"`, not `string`. So a test env built to
 * exercise routing or auth can never satisfy it field-for-field, and every
 * `worker.fetch(request, createEnv())` reported `Argument of type 'Env' is not
 * assignable to parameter of type 'CloudflareEnv'` — twelve errors in this file that
 * were all one missing cast in one factory.
 *
 * The cast is here rather than at the call sites for the reason it usually is: it is
 * one known boundary, and a reader can establish once that these tests are about the
 * worker's behaviour rather than about configuration completeness.
 */
function createEnv(): CloudflareEnv {
  // The two storage doubles are markers rather than working objects, and each one is a
  // cast that does not typecheck: `{ mock: true }` and `D1Database` do not overlap, so
  // every use was reported twice — once for the cast and once for the env it produced.
  return {
    AccessBridgeDB: { mock: true } as unknown as D1Database,
    AccessBridgeKV: { mock: true } as unknown as KVNamespace,
    CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn() } as unknown as SecretsStoreSecret,
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: vi.fn() } as unknown as SecretsStoreSecret,
  } as unknown as CloudflareEnv;
}

function createRunRequest(): Request {
  return new Request('https://cron-tasks.internal/run', {
    method: 'POST',
    body: JSON.stringify({
      cron: '*/10 * * * *',
      scheduledTime: 123_456,
    }),
  });
}

describe('CronTasksWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const taskSpy of Object.values(taskSpies)) {
      taskSpy.mockReset();
      taskSpy.mockResolvedValue(undefined);
    }
  });

  it('runs phase 1 before phase 2 tasks', async () => {
    // No `Env` annotation: `createEnv()` returns `CloudflareEnv`, and re-narrowing it
    // to the hand-written global `Env` reintroduced exactly the mismatch this factory
    // exists to avoid — the worker entry point wants `CloudflareEnv`.
    const env = createEnv();
    const worker: CronTasksWorker = new CronTasksWorker(createDurableObjectState(), env);

    const response: Response = await worker.fetch(createRunRequest());

    await expect(response.json()).resolves.toEqual({ status: 'completed' });
    expect(response.status).toBe(200);
    expect(taskSpies.credentialCacheRefresh).toHaveBeenCalledOnce();
    expect(taskSpies.auditLogCleanup).toHaveBeenCalledOnce();
    expect(taskSpies.costDataCollection).toHaveBeenCalledOnce();
    expect(taskSpies.resourceInventoryCollection).toHaveBeenCalledOnce();
    expect(taskSpies.credentialCacheRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      taskSpies.auditLogCleanup.mock.invocationCallOrder[0],
    );

    const scheduledEvent: ScheduledController = taskSpies.credentialCacheRefresh.mock.calls[0][0];
    expect(scheduledEvent.cron).toBe('*/10 * * * *');
    expect(scheduledEvent.scheduledTime).toBe(123_456);
    expect(taskSpies.credentialCacheRefresh.mock.calls[0][1]).toBe(env);
  });

  it('returns accepted when a run is already active', async () => {
    let resolveFirstTask: () => void = () => undefined;
    taskSpies.credentialCacheRefresh.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirstTask = resolve;
      }),
    );

    const worker: CronTasksWorker = new CronTasksWorker(createDurableObjectState(), createEnv());
    const firstResponsePromise: Promise<Response> = worker.fetch(createRunRequest());
    await Promise.resolve();
    await Promise.resolve();

    const secondResponse: Response = await worker.fetch(createRunRequest());

    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toEqual({ status: 'already_running' });

    resolveFirstTask();
    await expect(firstResponsePromise).resolves.toHaveProperty('status', 200);
  });

  it('rejects unsupported routes and methods', async () => {
    const worker: CronTasksWorker = new CronTasksWorker(createDurableObjectState(), createEnv());

    const notFoundResponse: Response = await worker.fetch(new Request('https://cron-tasks.internal/missing', { method: 'POST' }));
    const methodResponse: Response = await worker.fetch(new Request('https://cron-tasks.internal/run'));

    expect(notFoundResponse.status).toBe(404);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('Allow')).toBe('POST');
  });
});
