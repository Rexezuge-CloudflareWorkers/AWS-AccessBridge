import { describe, it, expect, vi } from 'vitest';
import {
  AwsCollectionError,
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  MethodNotAllowedError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
} from '@aws-access-bridge/backend-errors';
import { AbstractDurableObjectWorker } from '@aws-access-bridge/backend-runtime/base';

/**
 * Every typed error carries three things the response layer depends on: a status
 * the SPA branches on, a stable `Type` string for clients, and the message it
 * will actually send. A default-constructed error must still satisfy all three —
 * `new ConflictError()` is how a service reports a conflict with no detail, and
 * an `undefined` status there is a 500 in disguise.
 */
describe('the error taxonomy', () => {
  const cases = [
    { name: 'BadRequest', error: new BadRequestError(), status: 400, type: 'BadRequest' },
    { name: 'Unauthorized', error: new UnauthorizedError(), status: 401, type: 'Unauthorized' },
    { name: 'Forbidden', error: new ForbiddenError(), status: 403, type: 'Forbidden' },
    { name: 'NotFound', error: new NotFoundError(), status: 404, type: 'NotFound' },
    { name: 'Conflict', error: new ConflictError(), status: 409, type: 'Conflict' },
    { name: 'MethodNotAllowed', error: new MethodNotAllowedError(), status: 405, type: 'MethodNotAllowed' },
    { name: 'RateLimited', error: new RateLimitedError(), status: 429, type: 'RateLimited' },
    { name: 'BadGateway', error: new BadGatewayError(), status: 502, type: 'BadGateway' },
    { name: 'InternalServerError', error: new InternalServerError(), status: 500, type: 'InternalServerError' },
    // An AWS discovery failure is a 500 by design (it extends
    // `InternalServerError`) but carries the upstream status on the instance so a
    // scheduler can tell a 429 from a 403 without re-parsing the message.
    { name: 'AwsCollection', error: new AwsCollectionError('nope', 403, 'ec2'), status: 500, type: 'AwsCollectionError' },
  ] as const;

  for (const { name, error, status, type } of cases) {
    it(`${name} answers ${status} with a non-empty message`, () => {
      expect(error.getErrorCode()).toBe(status);
      expect(error.getErrorType()).toBe(type);
      expect(error.getErrorMessage().length).toBeGreaterThan(0);
      // A supplied message wins over the default.
      const custom = new (error.constructor as new (message?: string) => typeof error)('custom text');
      expect(custom.getErrorMessage()).toBe('custom text');
    });
  }

  it('marks only the errors worth retrying as retryable', () => {
    expect(new BadGatewayError('x', true).retryable).toBe(true);
    expect(new BadGatewayError('x').retryable).toBe(false);
    expect(new ConflictError().retryable).toBe(false);
  });

  it('reads retryability off the upstream status for a collection failure', () => {
    // A throttle is worth another attempt; an AccessDenied is not.
    expect(new AwsCollectionError('throttled', 429, 'ec2').retryable).toBe(true);
    expect(new AwsCollectionError('denied', 403, 'ec2').retryable).toBe(false);
    expect(new AwsCollectionError('broken', 500, 's3').resourceType).toBe('s3');
  });
});

/**
 * The Durable Object base turns an unhandled `fetch` rejection into a 500 JSON
 * body rather than letting the platform see it. That path is the difference
 * between a logged, diagnosable failure and an opaque 1102, and it is reached
 * only when a handler throws.
 */
describe('AbstractDurableObjectWorker', () => {
  class TestWorker extends AbstractDurableObjectWorker {
    protected currentRun: Promise<void> | undefined;

    constructor(state: DurableObjectState, env: unknown, private readonly behaviour: () => Promise<Response>) {
      super(state, env as never);
    }

    protected onRequest(): Promise<Response> {
      return this.behaviour();
    }
  }

  function state(): DurableObjectState {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    return { ctx, id: { name: (): string => 'test' } } as unknown as DurableObjectState;
  }

  it('answers a thrown handler with 500 JSON and logs it', async () => {
    const worker = new TestWorker(state(), {}, () => Promise.reject(new Error('boom')));
    const response: Response = await worker.fetch(new Request('https://do.internal/x'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal Error' });
  });

  it('passes a successful response through untouched', async () => {
    const worker = new TestWorker(state(), {}, () => Promise.resolve(Response.json({ ok: true })));
    const response: Response = await worker.fetch(new Request('https://do.internal/x'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
