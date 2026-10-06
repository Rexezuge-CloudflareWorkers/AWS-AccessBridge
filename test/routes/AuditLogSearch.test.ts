import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListAuditLogsRoute } from '@/endpoints/user/admin/audit-logs/GET';
import { AuditService } from '@aws-access-bridge/backend-services/audit/AuditService';
import { UserIdentityService } from '@aws-access-bridge/backend-services/identity/UserIdentityService';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-services/audit/AuditService');
vi.mock('@aws-access-bridge/backend-services/identity/UserIdentityService');
// The route is an admin one, so `IAdminActivityAPIRoute` checks super-admin first.
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

const EMAIL = 'user@example.com';

function context(query = ''): ReturnType<typeof createRouteContext> {
  return createRouteContext({
    method: 'GET',
    url: `https://worker.example.com/user/admin/audit-logs${query}`,
  });
}

describe('ListAuditLogsRoute account filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AuditService.prototype.queryLogs).mockResolvedValue({ logs: [], total: 0 });
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  });

  it('resolves the account id so the search survives an address change', async () => {
    // Regression: the route passed only `userEmail`, and the address arm of the
    // owner predicate is the `user_id IS NULL` fallback — which an attributed row
    // never takes. So after a user's address changed, searching by their *current*
    // address returned nothing at all, even though the id arm would have matched
    // every row they ever wrote.
    vi.mocked(UserIdentityService.prototype.resolveUserId).mockResolvedValue('usr_abc');

    await new ListAuditLogsRoute({} as never).handle(context(`?userEmail=${EMAIL}`));

    expect(AuditService.prototype.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: EMAIL, userId: 'usr_abc' }),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('keeps the address alongside the id, since it narrows the unattributed rows', async () => {
    vi.mocked(UserIdentityService.prototype.resolveUserId).mockResolvedValue('usr_abc');
    await new ListAuditLogsRoute({} as never).handle(context(`?userEmail=${EMAIL}`));
    const [filters] = vi.mocked(AuditService.prototype.queryLogs).mock.calls[0];
    expect(filters.userEmail).toBe(EMAIL);
  });

  it('does not resolve an id when no address filter was given', async () => {
    await new ListAuditLogsRoute({} as never).handle(context());
    expect(UserIdentityService.prototype.resolveUserId).not.toHaveBeenCalled();
    expect(vi.mocked(AuditService.prototype.queryLogs).mock.calls[0][0]).not.toHaveProperty('userId');
  });

  it('still searches by address alone when the id cannot be resolved', async () => {
    // Best-effort: an unresolvable address must not turn a search into a 500, and
    // the address arm alone is the behaviour that predates the id.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(UserIdentityService.prototype.resolveUserId).mockResolvedValue(null);

    await new ListAuditLogsRoute({} as never).handle(context(`?userEmail=${EMAIL}`));

    const [filters] = vi.mocked(AuditService.prototype.queryLogs).mock.calls[0];
    expect(filters.userEmail).toBe(EMAIL);
    expect(filters.userId).toBeUndefined();
  });

  it('propagates nothing and still answers when the identity lookup itself fails', async () => {
    // The spy is captured rather than read back off `console.warn`. `vi.spyOn` returns
    // it, and the installed function keeps the plain overload signature — so
    // `console.warn.mock` does not exist, and the assertion could not be written the way
    // it was. Reading the recorded calls off the value the call returned is also the
    // only version that still works once the install is un-restored.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(UserIdentityService.prototype.resolveUserId).mockRejectedValue(new Error('d1 is busy'));

    await new ListAuditLogsRoute({} as never).handle(context(`?userEmail=${EMAIL}`));

    expect(warn.mock.calls.flat().join(' ')).toContain('d1 is busy');
    expect(AuditService.prototype.queryLogs).toHaveBeenCalledOnce();
  });
});
