import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatShellExport } from '@aws-access-bridge/web/lib/shellExport';
import { apiRequest, isUnauthorized } from '@aws-access-bridge/web/lib/api';
import { ServiceError, UnauthorizedError } from '@rexezuge/errors';

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

  it('apiRequest maps 204/empty bodies to undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('/x')).resolves.toBeUndefined();
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));
    await expect(apiRequest('/x')).resolves.toBeUndefined();
  });

  it('apiRequest throws ServiceError with backend messages', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ Exception: { Message: 'Denied' } }, 403));
    const error = await apiRequest('/x').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(403);
    expect(isUnauthorized(error)).toBe(false);
    expect(isUnauthorized(new UnauthorizedError('nope'))).toBe(true);
  });
});
