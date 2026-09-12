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

function createEnv(): Env {
  return {
    AccessBridgeDB: { mock: true } as D1Database,
    AccessBridgeKV: { mock: true } as KVNamespace,
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn() } as unknown as SecretsStoreSecret,
  } as Env;
}

function createRunRequest(): Request {
  return new Request('https://cron-tasks.internal/run', {
    method: 'POST',
    body: JSON.stringify({
      cron: '*/10 * * * *',
      scheduledTime: 123456,
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
    const env: Env = createEnv();
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
    expect(scheduledEvent.scheduledTime).toBe(123456);
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
    const methodResponse: Response = await worker.fetch(new Request('https://cron-tasks.internal/run', { method: 'GET' }));

    expect(notFoundResponse.status).toBe(404);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('Allow')).toBe('POST');
  });
});
