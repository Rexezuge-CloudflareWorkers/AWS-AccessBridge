import { describe, it, expect, vi } from 'vitest';
import { FetchHttpClient, HttpFetchError, StubHttpClient, isRetryableHttpStatus } from '@aws-access-bridge/backend-services/http';

describe('StubHttpClient', () => {
  it('records calls and serves queued JSON via fetchJson', async () => {
    const stub = new StubHttpClient();
    stub.queueJson({ hello: 'world' }).queueJson([1, 2, 3]);
    await expect(stub.fetchJson('https://example.com/a')).resolves.toEqual({ hello: 'world' });
    await expect(stub.fetchJson('https://example.com/b')).resolves.toEqual([1, 2, 3]);
    expect(stub.calls.map((c) => c.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('serves queued responses via fetch()', async () => {
    const stub = new StubHttpClient().queueResponse(new Response('{"ok":true}', { status: 200 }));
    const response = await stub.fetch('https://example.com/r');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects queued errors and empty queues', async () => {
    const stub = new StubHttpClient().queueError(new Error('boom'));
    await expect(stub.fetchJson('https://example.com/e')).rejects.toThrow('boom');
    await expect(stub.fetchJson('https://example.com/empty')).rejects.toThrow('no queued response');
  });

  it('prefers handler results and wraps non-OK responses in HttpFetchError', async () => {
    const stub = new StubHttpClient(() => new Response('nope', { status: 500, statusText: 'Server Error' }));
    await expect(stub.fetchJson('https://example.com/x')).rejects.toBeInstanceOf(HttpFetchError);
    const seen = new StubHttpClient().setHandler(() => ({ custom: true }));
    await expect(seen.fetchJson('https://example.com/y')).resolves.toEqual({ custom: true });
    expect(seen.calls).toHaveLength(1);
  });

  it('supports the legacy Response-handler constructor', async () => {
    const stub = new StubHttpClient(() => new Response('legacy'));
    await expect((await stub.fetch('https://example.com/l')).text()).resolves.toBe('legacy');
  });
});

describe('FetchHttpClient + HttpFetchError', () => {
  it('fetchJson parses bodies and throws on non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"a":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(new FetchHttpClient().fetchJson('https://example.com/j')).resolves.toEqual({ a: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(200)).toBe(false);
  });
});
