import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_RETRY_DELAY_MS, RetryingAwsClient, HttpFetchError } from '@aws-access-bridge/backend-services/http';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';

/**
A signed-client double that replays a scripted sequence of responses.
*/
function scriptedClient(...responses: Array<Response | Error>) {
  const fetch = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      fetch.mockRejectedValueOnce(response);
    } else {
      fetch.mockResolvedValueOnce(response);
    }
  }
  return { fetch, signed: { fetch } };
}

const throttle = (): Response => new Response('Throttling', { status: 429 });

describe('RetryingAwsClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a successful response without retrying', async () => {
    const { fetch, signed } = scriptedClient(new Response('ok', { status: 200 }));
    const response = await new RetryingAwsClient(signed, 3).fetch('https://example.com');
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retries a 429 and succeeds', async () => {
    const { fetch, signed } = scriptedClient(throttle(), new Response('ok', { status: 200 }));
    const response = await new RetryingAwsClient(signed, 3).fetch('https://example.com');
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx and succeeds', async () => {
    for (const status of [500, 502, 503]) {
      const { fetch, signed } = scriptedClient(new Response('x', { status }), new Response('ok', { status: 200 }));
      await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).resolves.toMatchObject({ status: 200 });
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it('does not retry a 4xx, which would fail identically', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { fetch, signed } = scriptedClient(new Response('nope', { status }), new Response('ok', { status: 200 }));
      const response = await new RetryingAwsClient(signed, 3).fetch('https://example.com');
      expect(response.status).toBe(status);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it('gives up after maxAttempts and returns the last response', async () => {
    const { fetch, signed } = scriptedClient(throttle(), throttle(), throttle());
    const response = await new RetryingAwsClient(signed, 3).fetch('https://example.com');
    expect(response.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a thrown transport error', async () => {
    const { fetch, signed } = scriptedClient(new TypeError('network'), new Response('ok', { status: 200 }));
    await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rethrows the final transport error once attempts are exhausted', async () => {
    const { signed } = scriptedClient(new TypeError('network'), new TypeError('network'), new TypeError('network'));
    await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).rejects.toBeInstanceOf(TypeError);
  });

  it('honours Retry-After, the authoritative backoff request', async () => {
    vi.useFakeTimers();
    const withRetryAfter = new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } });
    const { fetch, signed } = scriptedClient(withRetryAfter, new Response('ok', { status: 200 }));

    const pending = new RetryingAwsClient(signed, 3).fetch('https://example.com');
    // The first retry must not fire before the requested 2s.
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially, halving the window under a fixed jitter', async () => {
    // Without jitter every concurrent request would retry in lockstep and
    // reproduce the burst that caused the throttle. Injected here so the window
    // is deterministic: `jitter` returns `max / 2`, turning the exponential
    // window into an observable 50ms then 100ms.
    const delays: number[] = [];
    const client = new RetryingAwsClient({ fetch: vi.fn().mockResolvedValue(throttle()) }, 3, 100, (max: number) =>
      Math.floor(max / 2),
    );
    const spy = vi.spyOn(globalThis, 'setTimeout');
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    await client.fetch('https://example.com').catch(() => undefined);
    spy.mockRestore();
    // base 100ms at attempt 0 → 100; at attempt 1 → 200; halved by the jitter.
    expect(delays).toEqual([50, 100]);
  });

  it('keeps every jittered delay inside its exponential window', async () => {
    // The real `cryptoJitter` must never exceed the window it is given.
    const client = new RetryingAwsClient({ fetch: vi.fn().mockResolvedValue(throttle()) }, 3, 100);
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    await client.fetch('https://example.com').catch(() => undefined);
    spy.mockRestore();
    for (const [index, delay] of delays.entries()) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(100 * 2 ** index);
    }
  });
});

/**
 * `Retry-After` is stated in seconds for a client that can wait indefinitely. A
 * Workers request cannot: sleeping 120s outlives the request's own wall-clock
 * limit, so the caller sees a timeout instead of the throttle that actually
 * happened. The client therefore declines a wait it cannot afford rather than
 * shortening it (a shorter sleep just earns another throttle).
 */
describe('RetryingAwsClient caps an unaffordable Retry-After', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('declines a Retry-After beyond the ceiling instead of sleeping past the request', async () => {
    const { fetch, signed } = scriptedClient(new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } }));
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    const response = await new RetryingAwsClient(signed, 3).fetch('https://example.com');
    spy.mockRestore();

    // The server's own answer comes back rather than a 120s sleep.
    expect(response.status).toBe(429);
    expect(fetch).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });

  it('honours a Retry-After it can afford', async () => {
    const { fetch, signed } = scriptedClient(
      new Response('wait', { status: 429, headers: { 'Retry-After': '3' } }),
      new Response('ok', { status: 200 }),
    );
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    await new RetryingAwsClient(signed, 3).fetch('https://example.com');
    spy.mockRestore();
    expect(delays).toEqual([3000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never exceeds the ceiling on its own exponential window', async () => {
    const client = new RetryingAwsClient({ fetch: vi.fn().mockResolvedValue(throttle()) }, 6, 100, (max: number) => max);
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      handler();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);

    await client.fetch('https://example.com');
    spy.mockRestore();
    // 2**5 * 100ms would be 3200ms uncapped; the ceiling holds it at MAX_RETRY_DELAY_MS.
    expect(delays.length).toBeGreaterThan(0);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    }
  });
});

describe('RetryingAwsClient classifies the throw path', () => {
  it('surfaces a permanent rejection on the first attempt', async () => {
    // The regression this exists for: every rejection used to be retried, so an
    // AccessDenied burned all three attempts plus the backoff schedule before
    // reaching the caller.
    const { fetch, signed } = scriptedClient(new Error('AccessDenied: not authorized to perform sts:AssumeRole'));
    await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).rejects.toThrow(/AccessDenied/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('surfaces a malformed-body rejection without retrying it', async () => {
    const { fetch, signed } = scriptedClient(new HttpFetchError(200, 'Malformed JSON', 'not json', { retryable: false }));
    await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).rejects.toBeInstanceOf(HttpFetchError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('still retries a transient rejection', async () => {
    const { fetch, signed } = scriptedClient(new Error('Throttling: slow down'), new Response('ok', { status: 200 }));
    await expect(new RetryingAwsClient(signed as never, 3).fetch('https://example.com')).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('StsService retries throttled calls', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ASSUME_XML = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
<AccessKeyId>ASIA</AccessKeyId><SecretAccessKey>shh</SecretAccessKey>
<SessionToken>tok</SessionToken><Expiration>2025-01-01T00:00:00Z</Expiration>
</Credentials></AssumeRoleResult></AssumeRoleResponse>`;

  /**
   * A credential chain is walked hop by hop, so one throttled `AssumeRole` fails
   * the whole operation for the caller. This pins the retry at the service level,
   * not just at the client level.
   */
  it('retries a throttled AssumeRole instead of surfacing it', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Throttling', { status: 429 }))
      .mockResolvedValueOnce(new Response(ASSUME_XML, { status: 200 }));

    const pending = new StsService((() => ({ fetch }))).assumeRole('arn:aws:iam::123456789012:role/Dev', {
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    }, 'session');
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ accessKeyId: 'ASIA' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('surfaces a persistent AccessDenied rather than retrying it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    await expect(
      new StsService((() => ({ fetch }))).assumeRole(
        'arn:aws:iam::123456789012:role/Dev',
        { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
        'session',
      ),
    ).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });
});