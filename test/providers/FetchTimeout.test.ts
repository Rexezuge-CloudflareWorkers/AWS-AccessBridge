import { describe, it, expect, vi } from 'vitest';
import { BadGatewayError } from '@aws-access-bridge/backend-errors';
import {
  TimeoutAwsClient,
  createAwsClientFactory,
  DEFAULT_AWS_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
} from '@aws-access-bridge/provider-clients/aws';
import { StsClient } from '@aws-access-bridge/provider-clients/aws/StsClient';
import type { AwsSignedClient } from '@aws-access-bridge/provider-clients/aws';

/**
 * A fetch that never answers on its own and only settles when its signal fires —
 * which is what a hung AWS endpoint looks like to the caller.
 */
function hangingFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      // A real abort rejects with the signal's own reason. The caller of
      // `fetchWithTimeout` sees a *combined* signal, so this stub deliberately
      // reports the platform's abort shape rather than the caller's reason.
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
}

describe('fetch timeout', () => {
  it('has a bounded, generous default', () => {
    expect(DEFAULT_AWS_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_AWS_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('maps a hung call to a retryable BadGatewayError naming the host', async () => {
    const client = new TimeoutAwsClient({ fetch: hangingFetch() }, 20);
    const failure: unknown = await client.fetch('https://sts.us-east-1.amazonaws.com/').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadGatewayError);
    expect((failure as BadGatewayError).getErrorCode()).toBe(502);
    expect((failure as BadGatewayError).retryable).toBe(true);
    expect((failure as BadGatewayError).message).toContain('sts.us-east-1.amazonaws.com');
    expect((failure as BadGatewayError).message).toContain('20ms');
  });

  it('also bounds a server that sends headers and then stalls the body', async () => {
    // Like a real fetch, the body stream errors when the request's signal aborts.
    const inner: AwsSignedClient = {
      fetch: (_url: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason)),
            }),
            { status: 200 },
          ),
        ),
    };
    await expect(new TimeoutAwsClient(inner, 20).fetch('https://sts.amazonaws.com/')).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('hands the signal to the underlying fetch', async () => {
    const inner = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(new Response(init?.signal ? 'ok' : 'no-signal')));
    const response: Response = await new TimeoutAwsClient({ fetch: inner }, 1000).fetch('https://sts.amazonaws.com/', {
      method: 'POST',
      body: 'x',
    });
    await expect(response.text()).resolves.toBe('ok');
    expect(inner.mock.calls[0]?.[1]).toMatchObject({ body: 'x', method: 'POST' });
  });

  it('passes a fast response through with status, headers and body intact', async () => {
    const inner: AwsSignedClient = {
      fetch: () => Promise.resolve(new Response('<x/>', { headers: { 'x-amz-request-id': 'abc' }, status: 403, statusText: 'Forbidden' })),
    };
    const response: Response = await new TimeoutAwsClient(inner, 1000).fetch('https://sts.amazonaws.com/');
    expect(response.status).toBe(403);
    expect(response.statusText).toBe('Forbidden');
    expect(response.headers.get('x-amz-request-id')).toBe('abc');
    await expect(response.text()).resolves.toBe('<x/>');
  });

  it('survives a null-body status', async () => {
    const response: Response = await fetchWithTimeout(() => Promise.resolve(new Response(null, { status: 204 })), undefined, 'host', 1000);
    expect(response.status).toBe(204);
  });

  it('rethrows a caller abort rather than reporting it as an upstream fault', async () => {
    const controller = new AbortController();
    const pending = fetchWithTimeout(hangingFetch().bind(undefined, 'u'), { signal: controller.signal }, 'host', 5000);
    controller.abort();
    // The caller gave up, so nobody is waiting on a `BadGatewayError` — that is
    // only correct when the *deadline* fired, which is what this long timeout
    // guarantees it did not.
    await expect(pending).rejects.toThrow(DOMException);
    await expect(pending).rejects.not.toBeInstanceOf(BadGatewayError);
  });

  it('rethrows a non-timeout failure unchanged', async () => {
    const boom = new Error('connection reset');
    await expect(fetchWithTimeout(() => Promise.reject(boom), undefined, 'host', 1000)).rejects.toBe(boom);
  });

  it('makes a hung STS call fail instead of wedging the caller', async () => {
    // The factory is the injection seam: a short timeout makes the hang observable.
    const factory = createAwsClientFactory(20);
    expect(typeof factory({ keys: { accessKeyId: 'AKID', secretAccessKey: 'S' }, region: 'us-east-1', service: 'sts' }).fetch).toBe(
      'function',
    );

    const sts = new StsClient(() => new TimeoutAwsClient({ fetch: hangingFetch() }, 20));
    await expect(sts.validateCredentials('AKID', 'SECRET')).rejects.toBeInstanceOf(BadGatewayError);
  });
});
