import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatShellExport } from '@aws-access-bridge/web/lib/shellExport';
import { ApiError, apiCall, apiFetch, apiRequest, isUnauthorized, readJson } from '@aws-access-bridge/web/lib/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('formatShellExport', () => {
  it('renders exports with and without session tokens', () => {
    expect(formatShellExport('AK', 'SK', 'ST')).toBe(
      'export AWS_ACCESS_KEY_ID="AK"\nexport AWS_SECRET_ACCESS_KEY="SK"\nexport AWS_SESSION_TOKEN="ST"',
    );
    expect(formatShellExport('AK', 'SK')).toBe('export AWS_ACCESS_KEY_ID="AK"\nexport AWS_SECRET_ACCESS_KEY="SK"');
  });
});

describe('lib/api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apiRequest resolves typed bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [] }));
    await expect(apiRequest<{ teams: unknown[] }>('/user/admin/teams')).resolves.toEqual({ teams: [] });
  });

  it('apiRequest maps 204/empty bodies to {}', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('/x')).resolves.toEqual({});
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));
    await expect(apiRequest('/x')).resolves.toEqual({});
  });

  it('apiRequest throws ApiError with backend messages', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ Exception: { Message: 'Denied' } }, 403));
    const error = await apiRequest('/x').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect(isUnauthorized(error)).toBe(false);
    expect(isUnauthorized(new ApiError(401, 'nope'))).toBe(true);
  });

  it('apiFetch/apiCall preserve the legacy Result model', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const fetched = await apiFetch<Record<string, boolean>>('/x');
    expect(fetched.ok).toBe(true);
    const called = await apiCall('/x', 'GET');
    expect(called.ok).toBe(true);
    vi.mocked(fetch).mockRejectedValue(new Error('down'));
    const failed = await apiFetch('/x');
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('Network error');
  });

  it('readJson passes through parsed bodies', async () => {
    await expect(readJson<{ a: number }>(jsonResponse({ a: 1 }))).resolves.toEqual({ a: 1 });
  });
});
