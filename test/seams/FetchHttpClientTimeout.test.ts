import { afterEach, describe, it, expect, vi } from 'vitest';
import { BadGatewayError } from '@aws-access-bridge/backend-errors';
import { FetchHttpClient } from '@aws-access-bridge/backend-services/http';

/**
 * A global `fetch` that only settles when its signal fires — a hung endpoint.
 */
function stubHangingFetch(): ReturnType<typeof vi.fn> {
  const hanging = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // The platform's abort shape: `fetchWithTimeout` hands `fetch` a signal
        // combined with its own deadline, so the reason here is not the caller's.
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }),
  );
  vi.stubGlobal('fetch', hanging);
  return hanging;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FetchHttpClient timeout', () => {
  it('fails a hung fetch with a retryable BadGatewayError', async () => {
    stubHangingFetch();
    const failure: unknown = await new FetchHttpClient(20)
      .fetch('https://signin.aws.amazon.com/federation')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadGatewayError);
    expect((failure as BadGatewayError).retryable).toBe(true);
    expect((failure as BadGatewayError).message).toContain('signin.aws.amazon.com');
  });

  it('fails a hung fetchJson the same way', async () => {
    stubHangingFetch();
    await expect(new FetchHttpClient(20).fetchJson('https://example.com/j')).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('still returns a prompt response untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"a":1}', { status: 200 })));
    const client = new FetchHttpClient();
    await expect(client.fetchJson('https://example.com/j')).resolves.toEqual({ a: 1 });
  });

  it('sends a signal on every request', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', spy);
    await new FetchHttpClient().fetch('https://example.com/x');
    expect((spy.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
