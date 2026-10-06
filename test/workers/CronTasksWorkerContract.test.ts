import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronTasksWorker } from '@aws-access-bridge/background/CronTasksWorker';


/**
 * The cron Durable Object had 55% branch coverage and 14% function coverage. Its job
 * is narrow and load-bearing: it is the only trigger for the whole background
 * pipeline, it must never overlap with itself, and it must report a failed run as
 * failed — a silent success there reads as "everything is fine" while retention and
 * collection quietly stop.
 *
 * The task registry is mocked rather than the DAOs, so these tests are about the
 * Durable Object's own contract. The tasks' behaviour is covered by
 * `test/tasks/CollectionTasks.test.ts`; mocking them here keeps the two from
 * duplicating each other.
 */

/**
 * The handle resolves to a task-run summary, so the mock is declared with an
 * explicit async signature. Left as a bare `vi.fn()`, TypeScript infers a `void`
 * return and `no-misused-promises` rejects the `async` implementation that the
 * overlap test needs.
 */
const registry = vi.hoisted(() => {
  const makeHandle = (): ReturnType<typeof vi.fn<() => Promise<unknown>>> => vi.fn<() => Promise<unknown>>();
  return { phase1: [{ handle: makeHandle() }], phase2: [{ handle: makeHandle() }] };
});

vi.mock('@aws-access-bridge/background/scheduled', () => ({
  tasksForPhase: (phase: number) => (phase === 1 ? registry.phase1 : registry.phase2),
}));

/**
The task shape `tasksForPhase` is mocked with; only `handle` is reached.
*/
interface TaskDouble {
  handle: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
}

const ENV = { AccessBridgeDB: {}, AccessBridgeKV: {} } as unknown as CloudflareEnv;

function createContext(): ExecutionContext {
  return { passThroughOnException: vi.fn(), waitUntil: vi.fn() } as unknown as ExecutionContext;
}

function post(body?: unknown, path = '/run', method = 'POST'): Request {
  return new Request(`https://do.internal${path}`, {
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    method,
  });
}

function worker(): CronTasksWorker {
  // `DurableObjectState` is structural here: only `ctx` is touched, and the state
  // object itself is never read.
  const state = { ctx: createContext(), id: { name: () => 'cron' } } as unknown as DurableObjectState;
  return new CronTasksWorker(state, ENV);
}

function handleOf(index: 0 | 1, phase: 1 | 2): TaskDouble['handle'] {
  return (registry[`phase${phase}`][index]).handle;
}

/**
`fetch` resolves to a Response; binding it keeps the assertion off the `await`.
*/
async function fetchOnce(durable: CronTasksWorker, request: Request): Promise<Response> {
  return durable.fetch(request);
}

/**
Status only, for the many assertions that are about the code and not the body.
*/
async function statusOf(durable: CronTasksWorker, request: Request): Promise<number> {
  const response: Response = await fetchOnce(durable, request);
  return response.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const task of [...registry.phase1, ...registry.phase2] as TaskDouble[]) {
    task.handle.mockResolvedValue({ itemsFailed: 0, itemsProcessed: 0, summary: 'ok' });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request validation', () => {
  it('answers 404 for any path other than /run', async () => {
    // A typo in the trigger path must be visible rather than silently running nothing.
    const response = await worker().fetch(post(undefined, '/elsewhere'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Not Found' });
  });

  it('answers 405 with an Allow header for a non-POST method', async () => {
    const response = await worker().fetch(post(undefined, '/run', 'GET'));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('rejects the wrong method on the wrong path with 404, not 405', async () => {
    expect(await statusOf(worker(), post(undefined, '/elsewhere', 'GET'))).toBe(404);
  });
});

describe('run reporting', () => {
  it('reports a completed run', async () => {
    const response = await worker().fetch(post({ cron: '*/10 * * * *', scheduledTime: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed' });
  });

  it('runs both phases', async () => {
    await worker().fetch(post({ cron: 'x', scheduledTime: 1 }));
    expect(handleOf(0, 1)).toHaveBeenCalledOnce();
    expect(handleOf(0, 2)).toHaveBeenCalledOnce();
  });

  /**
   * A malformed trigger body is itself a defect worth seeing in a production log
   * tail, so it warns — while still letting the run proceed with a synthesized cron
   * expression rather than dropping the tick entirely.
   */
  it('warns but still runs when the trigger body is not JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await worker().fetch(post('not json'));
    expect(warn).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  /**
   * Valid JSON with wrongly-typed fields is not a malformed body, so it does not
   * warn — `createScheduledController` substitutes defaults field by field instead,
   * and the tick still runs.
   */
  it('substitutes defaults for wrongly-typed fields without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await worker().fetch(post({ cron: 42, scheduledTime: 'soon' }));
    expect(warn).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  /**
   * The run must be reported as failed. A silent success here is the failure mode
   * that matters: retention and collection would stop while the log said the
   * pipeline completed.
   */
  it('reports a failed run as failed, naming the task', async () => {
    handleOf(0, 1).mockRejectedValue(new TypeError('chain is a cycle'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await worker().fetch(post({ cron: 'x', scheduledTime: 1 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: 'failed' });
    expect(error).toHaveBeenCalled();
  });

  /**
   * `allSettled` rather than `Promise.all`: one failing task must neither abort its
   * phase-mates nor hide behind a single rejection.
   */
  it('still runs the later phase when an earlier one fails', async () => {
    handleOf(0, 1).mockRejectedValue(new Error('phase 1 exploded'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await worker().fetch(post({ cron: 'x', scheduledTime: 1 }));
    expect(handleOf(0, 2)).toHaveBeenCalledOnce();
  });

  it('reports a non-Error rejection without losing it', async () => {
    handleOf(0, 1).mockRejectedValue('a bare string');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await statusOf(worker(), post({ cron: 'x', scheduledTime: 1 }))).toBe(500);
    expect(error).toHaveBeenCalled();
  });
});

describe('overlap protection', () => {
  /**
   * A Durable Object is single-threaded but re-entrant across awaits, so two cron
   * ticks arriving together would interleave and double every collection. The 202 is
   * the deliberate answer: the second tick is skipped, not queued.
   */
  it('answers 202 while a run is already in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handleOf(0, 1).mockImplementation(async () => {
      await gate;
      return { itemsFailed: 0, itemsProcessed: 0, summary: 'ok' };
    });

    // One instance: `currentRun` is per-object state, and the point is that a
    // *second tick arriving at the same object* is refused.
    const durable = worker();
    const first = durable.fetch(post({ cron: 'x', scheduledTime: 1 }));
    const second = await durable.fetch(post({ cron: 'x', scheduledTime: 2 }));

    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ status: 'already_running' });

    release();
    const settled: Response = await first;
    expect(settled.status).toBe(200);
    // The skipped tick must not have run a second time.
    expect(handleOf(0, 1)).toHaveBeenCalledOnce();
  });

  it('accepts a new run once the previous one has settled', async () => {
    const durable = worker();
    expect(await statusOf(durable, post({ cron: 'x', scheduledTime: 1 }))).toBe(200);
    // The in-flight guard must be released, or the DO would refuse every future tick.
    expect(await statusOf(durable, post({ cron: 'x', scheduledTime: 2 }))).toBe(200);
  });

  it('accepts a new run after the previous one failed', async () => {
    handleOf(0, 1).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const durable = worker();
    expect(await statusOf(durable, post({ cron: 'x', scheduledTime: 1 }))).toBe(500);
    expect(await statusOf(durable, post({ cron: 'x', scheduledTime: 2 }))).toBe(200);
  });
});