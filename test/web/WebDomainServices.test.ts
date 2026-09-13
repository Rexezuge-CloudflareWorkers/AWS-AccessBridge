import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listAccounts, setFavorite, setRoleHidden, assumeRoleKeys, buildFederateUrl } from '@aws-access-bridge/web/services/accountService';
import { loadSummary as loadCostSummary, loadTrends } from '@aws-access-bridge/web/services/costService';
import { loadSummary as loadResourceSummary, listResources, getConsoleDestination } from '@aws-access-bridge/web/services/resourceService';
import { loadCurrentUser, updatePreferredLanguage } from '@aws-access-bridge/web/services/authService';
import { formatMonthLabel, formatCurrency } from '@aws-access-bridge/web/lib/format';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('accountService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists via search when a term is present, paged otherwise', async () => {
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(jsonResponse(String(url).includes('search') ? { '1': { roles: [] } } : { totalAccounts: 0 })),
    );
    await expect(listAccounts({ showHidden: false, searchTerm: 'dev', pageSize: 10, currentPage: 1 })).resolves.toMatchObject({ total: 1 });
    await expect(listAccounts({ showHidden: true, searchTerm: '', pageSize: 10, currentPage: 2 })).resolves.toMatchObject({ total: 0 });
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/user/assumables/search?q=dev');
    expect(urls[1]).toContain('offset=10');
  });

  it('toggles favorites and hidden flags with correct verbs', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({})));
    await setFavorite('1', false);
    await setFavorite('1', true);
    await setRoleHidden('1', 'Dev', true);
    const methods = vi.mocked(fetch).mock.calls.map((call) => (call[1] as RequestInit)?.method);
    expect(methods).toEqual(['POST', 'DELETE', 'POST']);
  });

  it('assumes roles and builds federate URLs', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ accessKeyId: 'AK' })));
    await expect(assumeRoleKeys('123456789012', 'Dev')).resolves.toMatchObject({ accessKeyId: 'AK' });
    expect(buildFederateUrl('1', 'Dev')).toContain('/user/aws/federate?');
  });

  it('throws typed errors on failures', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ Exception: { Message: 'Nope' } }, 500)));
    await expect(listAccounts({ showHidden: false, searchTerm: '', pageSize: 10, currentPage: 1 })).rejects.toThrow('Nope');
  });
});

describe('costService + resourceService + authService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads cost summaries and trends', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ accounts: {}, grandTotal: 0 })));
    await expect(loadCostSummary()).resolves.toMatchObject({ grandTotal: 0 });
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ months: [{ period: '2025-01' }] })));
    await expect(loadTrends()).resolves.toHaveLength(1);
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ months: null })));
    await expect(loadTrends()).resolves.toEqual([]);
  });

  it('loads resource summaries, lists, and deep-links', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ totalResources: 1, byType: {}, byAccount: {} })));
    await expect(loadResourceSummary()).resolves.toMatchObject({ totalResources: 1 });
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response('err', { status: 500 })));
    await expect(loadResourceSummary()).resolves.toBeNull();

    const item = { awsAccountId: '1', region: 'us-east-1', resourceType: 'ec2', resourceId: 'i-1', resourceName: 'web', state: 'running', metadata: {} };
    expect(getConsoleDestination(item)?.path).toContain('i-1');
    expect(getConsoleDestination({ ...item, resourceType: 's3', region: 'global' })).toMatchObject({ region: undefined });
    expect(getConsoleDestination({ ...item, resourceType: 'dynamodb', resourceId: 'us-east-1:table' })?.path).toContain('table');
    expect(getConsoleDestination({ ...item, resourceType: 'unknown' })).toBeNull();

    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ items: [], total: 0, rolesByAccount: {} })));
    await expect(listResources({ filterType: 'ec2', searchQuery: 'web', pageSize: 25, page: 0 })).resolves.toMatchObject({ total: 0 });
  });

  it('loads and saves the current user', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ email: 'u@e.com' })));
    await expect(loadCurrentUser()).resolves.toMatchObject({ email: 'u@e.com' });
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({})));
    await updatePreferredLanguage('de');
    const putCall = vi.mocked(fetch).mock.calls.find((call) => (call[1] as RequestInit)?.method === 'PUT');
    expect(putCall?.[0]).toBe('/user/me');
  });
});

describe('lib/format', () => {
  it('formats month labels and currency with fallbacks', () => {
    expect(formatMonthLabel('2025-03', 'en')).toContain('arch');
    expect(formatMonthLabel('2025-13', 'en')).toBe('13');
    expect(formatCurrency(12.5, 'USD', 'en')).toContain('12.50');
    expect(formatCurrency(12.5, 'NOPE-NOT-A-CURRENCY', 'en')).toBe('NOPE-NOT-A-CURRENCY 12.50');
  });
});
