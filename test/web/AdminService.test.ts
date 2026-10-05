import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanupOrphaned,
  createSpendAlert,
  deleteRoleConfig,
  deleteSpendAlert,
  disableDataCollection,
  discoverAccountRoles,
  enableDataCollection,
  grantAccess,
  removeAccountNickname,
  removeCredentialRelationship,
  revokeAccess,
  setAccountNickname,
  setRoleConfig,
  storeCredentialRelationship,
  storeCredentials,
  testCredentialChain,
  validateCredentials,
} from '@aws-access-bridge/web/services/adminService';
import { formatCurrency, formatMonthLabel, formatUnixDate, formatUnixTimestamp } from '@aws-access-bridge/web/lib/format';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
The (url, method, parsed body) of the single request made.
*/
function lastRequest(fetchMock: ReturnType<typeof vi.fn>): { url: string; method: string; body: Record<string, unknown> | undefined } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined };
}

describe('adminService', () => {
  beforeEach(() => {
    // A fresh Response per call: bodies are single-use, so a shared instance
    // would fail with "Body has already been read" on the second request.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps each mutation to its route, method and body', async () => {
    await setAccountNickname('123456789012', 'Prod');
    expect(lastRequest(vi.mocked(fetch))).toEqual({ url: '/user/admin/account/nickname', method: 'PUT', body: { awsAccountId: '123456789012', nickname: 'Prod' } });

    vi.mocked(fetch).mockClear();
    await removeAccountNickname('123456789012');
    expect(lastRequest(vi.mocked(fetch))).toEqual({ url: '/user/admin/account/nickname', method: 'DELETE', body: { awsAccountId: '123456789012' } });

    vi.mocked(fetch).mockClear();
    await storeCredentials('arn:role', 'AKID', 'SECRET', 'TOKEN');
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/credentials',
      method: 'POST',
      body: { principalArn: 'arn:role', accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' },
    });

    vi.mocked(fetch).mockClear();
    await storeCredentialRelationship('arn:child', 'arn:parent');
    expect(lastRequest(vi.mocked(fetch)).body).toEqual({ principalArn: 'arn:child', assumedBy: 'arn:parent' });

    vi.mocked(fetch).mockClear();
    await removeCredentialRelationship('arn:child');
    expect(lastRequest(vi.mocked(fetch))).toEqual({ url: '/user/admin/credentials/relationship', method: 'DELETE', body: { principalArn: 'arn:child' } });
  });

  it('omits the session token when validating long-lived credentials', async () => {
    await validateCredentials('AKID', 'SECRET');
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/credentials/validate',
      method: 'POST',
      body: { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: undefined },
    });
  });

  it('returns the discovery payloads from the read-ish admin calls', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ arn: 'arn:user', accountId: '123456789012' }));
    await expect(validateCredentials('AKID', 'SECRET')).resolves.toEqual({ arn: 'arn:user', accountId: '123456789012' });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, chain: [{ arn: 'arn:role', status: 'ok' }] }));
    await expect(testCredentialChain('arn:role')).resolves.toEqual({ success: true, chain: [{ arn: 'arn:role', status: 'ok' }] });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ roles: [{ roleName: 'Dev', arn: 'arn:role/Dev', description: 'dev' }] }));
    await expect(discoverAccountRoles('arn:role')).resolves.toEqual({ roles: [{ roleName: 'Dev', arn: 'arn:role/Dev', description: 'dev' }] });

    // The route returns per-table counts plus a `failures` list, not a single
    // `deleted` number — `cleanupOrphanedData` settles each table independently
    // so a partial run can still answer 200 and report what failed. This test
    // previously asserted a `{deleted: 7}` shape that the route never produced.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        deletedCounts: { awsAccounts: 1, roleConfigs: 2, teamAccounts: 1, spendAlerts: 1, costData: 1, resourceInventory: 1, dataCollectionConfig: 0 },
        totalDeleted: 7,
        failures: [],
      }),
    );
    await expect(cleanupOrphaned()).resolves.toEqual({
      deletedCounts: { awsAccounts: 1, roleConfigs: 2, teamAccounts: 1, spendAlerts: 1, costData: 1, resourceInventory: 1, dataCollectionConfig: 0 },
      totalDeleted: 7,
      failures: [],
    });
  });

  it('surfaces per-table failures from a partial cleanup', async () => {
    // A partial run is a 200, not an error — the caller must be able to tell the
    // administrator which tables were missed rather than reporting success.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        deletedCounts: { awsAccounts: 1, roleConfigs: 0, teamAccounts: 0, spendAlerts: 0, costData: 0, resourceInventory: 0, dataCollectionConfig: 0 },
        totalDeleted: 1,
        failures: ['spend_alerts'],
      }),
    );
    await expect(cleanupOrphaned()).resolves.toMatchObject({ totalDeleted: 1, failures: ['spend_alerts'] });
  });

  it('flattens the spend alert id out of its envelope, tolerating a missing one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ alert: { id: 'alert-1' } }));
    await expect(createSpendAlert({ threshold: 100 })).resolves.toEqual({ id: 'alert-1' });

    // A 204 or an empty envelope must not throw on property access.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(createSpendAlert({ threshold: 100 })).resolves.toEqual({});
  });

  it('sends access grants, revokes and role config with the right verbs', async () => {
    await grantAccess('u@e.com', '123456789012', 'Dev');
    expect(lastRequest(vi.mocked(fetch))).toEqual({ url: '/user/admin/access', method: 'POST', body: { userEmail: 'u@e.com', awsAccountId: '123456789012', roleName: 'Dev' } });

    vi.mocked(fetch).mockClear();
    await revokeAccess('u@e.com', '123456789012', 'Dev');
    expect(lastRequest(vi.mocked(fetch)).method).toBe('DELETE');

    vi.mocked(fetch).mockClear();
    await setRoleConfig('123456789012', 'Dev', { destinationPath: 'ec2' });
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/role/config',
      method: 'PUT',
      body: { awsAccountId: '123456789012', roleName: 'Dev', destinationPath: 'ec2' },
    });

    vi.mocked(fetch).mockClear();
    await deleteRoleConfig('123456789012', 'Dev');
    expect(lastRequest(vi.mocked(fetch)).method).toBe('DELETE');
  });

  it('toggles data collection and spend alerts', async () => {
    // `collectionTypes` is plural on purpose: `POST /user/admin/collection/config`
    // declares `required: ['principalArn', 'collectionTypes']` and applies the
    // list in one call. This test previously asserted a singular
    // `collectionType`, locking in a mismatch that had no caller to expose it.
    await enableDataCollection('arn:role', ['cost', 'resource']);
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/collection/config',
      method: 'POST',
      body: { principalArn: 'arn:role', collectionTypes: ['cost', 'resource'] },
    });

    vi.mocked(fetch).mockClear();
    await disableDataCollection('arn:role', 'cost');
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/collection/config',
      method: 'DELETE',
      body: { principalArn: 'arn:role', collectionType: 'cost' },
    });

    vi.mocked(fetch).mockClear();
    await deleteSpendAlert('alert-1');
    expect(lastRequest(vi.mocked(fetch))).toEqual({ url: '/user/admin/costs/alerts', method: 'DELETE', body: { alertId: 'alert-1' } });
  });

  it('sends an omitted userEmail as absent, not empty, so the route can fall back', async () => {
    // The route falls back to the authenticated admin only when `userEmail` is
    // absent; an empty string would be sent as a real (invalid) address.
    await grantAccess(undefined, '123456789012', 'Admin');
    expect(lastRequest(vi.mocked(fetch))).toEqual({
      url: '/user/admin/access',
      method: 'POST',
      body: { userEmail: undefined, awsAccountId: '123456789012', roleName: 'Admin' },
    });
  });

  it('omits a blank session token rather than sending an empty one', async () => {
    // An empty session token would be stored as a real value on the credentials
    // row instead of marking the credentials long-lived.
    await storeCredentials('arn:role', 'AK', 'SK');
    const body = lastRequest(vi.mocked(fetch)).body as { sessionToken?: string };
    expect(body.sessionToken).toBeUndefined();
  });

  it('propagates ApiError so callers can distinguish 401 from 500', async () => {
    const { ApiError } = await import('@aws-access-bridge/web/lib/api');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ Exception: { Type: 'Unauthorized', Message: 'nope' } }, 401));
    await expect(setAccountNickname('123456789012', 'x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('format helpers', () => {
  it('renders the month name for a well-formed cost period', () => {
    expect(formatMonthLabel('2025-06-01', 'en')).toBe('June');
  });

  it('falls back to the raw month slice when the period is not parseable', () => {
    // An unexpected period shape must not produce "NaN" or throw; the fallback is
    // `period.slice(5)`, i.e. everything after "YYYY-".
    expect(formatMonthLabel('not-a-period', 'en')).toBe('-period');
    expect(formatMonthLabel('2025-13-01', 'en')).toBe('13-01');
    expect(formatMonthLabel('2025-00-01', 'en')).toBe('00-01');
  });

  it('caches one formatter per locale', () => {
    // Exercised implicitly: repeated calls must not re-construct Intl objects.
    expect(formatMonthLabel('2025-01-01', 'de')).toBe('Januar');
    expect(formatMonthLabel('2025-02-01', 'de')).toBe('Februar');
  });

  it('formats currency, and degrades gracefully for an invalid currency code', () => {
    expect(formatCurrency(12.5, 'USD', 'en')).toContain('12.50');
    // An unknown ISO code makes Intl.NumberFormat throw; the helper must return
    // something readable rather than crashing the cost dashboard.
    expect(formatCurrency(12.5, 'NOT_A_CODE', 'en')).toBe('NOT_A_CODE 12.50');
  });

  it('formats unix timestamps and dates in the requested locale', () => {
    const seconds = Math.trunc(Date.parse('2025-06-02T12:00:00Z') / 1000);
    expect(formatUnixTimestamp(seconds, 'en')).toContain('2025');
    expect(formatUnixDate(seconds, 'en')).toContain('2025');
  });
});
