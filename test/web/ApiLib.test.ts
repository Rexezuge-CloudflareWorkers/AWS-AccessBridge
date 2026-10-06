import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiRequest, isUnauthorized, throwForResponse } from '@aws-access-bridge/web/lib/api';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true }))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a JSON body', async () => {
    await expect(apiRequest<{ ok: boolean }>('/x')).resolves.toEqual({ ok: true });
  });

  it('returns an empty object for 204 and for an empty body', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(apiRequest('/x')).resolves.toEqual({});

    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response('', { status: 200 })));
    await expect(apiRequest('/x')).resolves.toEqual({});
  });

  it('sends a JSON body only when one is supplied', async () => {
    await apiRequest('/x', { method: 'POST', body: { a: 1 } });
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe('{"a":1}');

    vi.mocked(fetch).mockClear();
    await apiRequest('/x', { method: 'GET' });
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBeUndefined();
  });

  it('throws ApiError carrying the backend Exception message', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(json({ Exception: { Type: 'BadRequest', Message: 'q is required' } }, 400)));
    await expect(apiRequest('/x')).rejects.toMatchObject({ name: 'ApiError', status: 400, message: expect.stringContaining('q is required') });
  });

  it('falls back to status text when the error body is not JSON', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response('<html>gateway</html>', { status: 502, statusText: 'Bad Gateway' })));
    await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('raises ApiError, not SyntaxError, for a 2xx non-JSON body', async () => {
    // Regression guard: an unguarded JSON.parse threw SyntaxError, which
    // isUnauthorized does not recognise — defeating the 401 handling this path
    // exists to drive when a proxy returns an HTML error page.
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 })));
    const error = await apiRequest('/x').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  it('recognises 401s through isUnauthorized', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(json({ Exception: { Type: 'Unauthorized', Message: 'no' } }, 401)));
    const error = await apiRequest('/user/me').catch((err: unknown) => err);
    expect(isUnauthorized(error)).toBe(true);

    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(json({}, 403)));
    expect(isUnauthorized(await apiRequest('/x').catch((err: unknown) => err))).toBe(false);
  });
});

describe('throwForResponse', () => {
  it('throws ApiError with the backend message', async () => {
    await expect(throwForResponse(json({ Exception: { Message: 'boom' } }, 409), 'ctx')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to status text when the body carries no Exception', async () => {
    const error = await throwForResponse(new Response('{}', { status: 418, statusText: "I'm a teapot" }), 'ctx').catch((err: unknown) => err as ApiError);
    expect(error.message).toContain('418');
  });
});
