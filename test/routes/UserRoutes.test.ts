import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCurrentUserRoute } from '@/endpoints/user/me/GET';
import { UpdateCurrentUserRoute } from '@/endpoints/user/me/PUT';
import { ListAssumablesRoute } from '@/endpoints/user/assumables/GET';
import { SearchAccountsRoute } from '@/endpoints/user/assumables/search/GET';
import { HideRoleRoute } from '@/endpoints/user/assumable/hidden/POST';
import { UnhideRoleRoute } from '@/endpoints/user/assumable/hidden/DELETE';
import { FavoriteAccountRoute } from '@/endpoints/user/favorites/POST';
import { UnfavoriteAccountRoute } from '@/endpoints/user/favorites/DELETE';
import { ListTokensRoute } from '@/endpoints/user/tokens/GET';
import { CreateTokenRoute } from '@/endpoints/user/tokens/POST';
import { DeleteTokenRoute } from '@/endpoints/user/tokens/DELETE';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { UserFavoriteAccountsDAO } from '@aws-access-bridge/backend-data/dao/UserFavoriteAccountsDAO';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserFavoriteAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserAccessTokenDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

describe('user profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/me returns identity with language preference', async () => {
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(false);
    vi.mocked(UserMetadataDAO.prototype.getPreferredLanguage).mockResolvedValue('de');
    const c = createRouteContext({ url: 'https://example.com/user/me' });
    await new GetCurrentUserRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com', isSuperAdmin: false, preferredLanguage: 'de' }),
    );
  });

  it('PUT /user/me stores the language preference', async () => {
    const c = createRouteContext({ method: 'PUT', body: { preferredLanguage: 'ja' }, url: 'https://example.com/user/me' });
    await new UpdateCurrentUserRoute({} as never).handle(c as never);
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', 'ja');
    expect(c.json).toHaveBeenCalledWith({ success: true, preferredLanguage: 'ja' });
  });
});

describe('assumables routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/assumables lists roles with totals', async () => {
    vi.mocked(AssumableRolesDAO.prototype.getTotalAccountsCount).mockResolvedValue(2);
    vi.mocked(AssumableRolesDAO.prototype.getAllRolesByUserEmail).mockResolvedValue({
      '123456789012': { roles: ['Dev'], nickname: 'dev', favorite: false },
    });
    const c = createRouteContext({ url: 'https://example.com/user/assumables?limit=10&offset=0' });
    await new ListAssumablesRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ totalAccounts: 2 }));
  });

  it('GET /user/assumables/search requires a query', async () => {
    const c = createRouteContext({ url: 'https://example.com/user/assumables/search' });
    await new SearchAccountsRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('GET /user/assumables/search returns matches', async () => {
    vi.mocked(AssumableRolesDAO.prototype.searchAccountsByQuery).mockResolvedValue({
      '123456789012': { roles: ['Dev'], nickname: 'dev', favorite: true },
    });
    const c = createRouteContext({ url: 'https://example.com/user/assumables/search?q=dev' });
    await new SearchAccountsRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ '123456789012': expect.anything() }));
  });

  it('POST /user/assumable/hidden hides roles after access check', async () => {
    vi.mocked(AssumableRolesDAO.prototype.verifyUserHasAccessToRole).mockResolvedValue(undefined);
    vi.mocked(AssumableRolesDAO.prototype.hideRole).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'POST', body: { awsAccountId: '123456789012', roleName: 'Dev' } });
    await new HideRoleRoute({} as never).handle(c as never);
    expect(AssumableRolesDAO.prototype.hideRole).toHaveBeenCalledWith('user@example.com', '123456789012', 'Dev');
    expect(c.json).toHaveBeenCalledWith({ success: true });
  });

  it('DELETE /user/assumable/hidden unhides roles', async () => {
    vi.mocked(AssumableRolesDAO.prototype.verifyUserHasAccessToRole).mockResolvedValue(undefined);
    vi.mocked(AssumableRolesDAO.prototype.unhideRole).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'POST', body: { awsAccountId: '123456789012', roleName: 'Dev' } });
    await new UnhideRoleRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('favorites routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/favorites ensures the account then favorites it', async () => {
    vi.mocked(AwsAccountsDAO.prototype.ensureAccountExists).mockResolvedValue(undefined);
    vi.mocked(UserFavoriteAccountsDAO.prototype.favoriteAccount).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'POST', body: { awsAccountId: '123456789012' } });
    await new FavoriteAccountRoute({} as never).handle(c as never);
    expect(AwsAccountsDAO.prototype.ensureAccountExists).toHaveBeenCalledWith('123456789012');
    expect(c.json).toHaveBeenCalledWith({ success: true });
  });

  it('DELETE /user/favorites unfavorites', async () => {
    vi.mocked(UserFavoriteAccountsDAO.prototype.unfavoriteAccount).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'POST', body: { awsAccountId: '123456789012' } });
    await new UnfavoriteAccountRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('token routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/tokens lists tokens', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue([
      { tokenId: 't1', userEmail: 'user@example.com', name: 'ci', createdAt: 1, expiresAt: 2, lastUsedAt: undefined },
    ]);
    const c = createRouteContext({ url: 'https://example.com/user/tokens' });
    await new ListTokensRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.any(Array) }));
  });

  it('POST /user/tokens mints a token under the limit', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue([]);
    vi.mocked(UserAccessTokenDAO.prototype.create).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'POST', body: { name: 'ci', expiresInDays: 7 } });
    await new CreateTokenRoute({} as never).handle(c as never);
    expect(UserAccessTokenDAO.prototype.create).toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'ci' }));
  });

  it('POST /user/tokens rejects over-limit creation', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByUserEmail).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        tokenId: `t${i}`,
        userEmail: 'u',
        name: 'n',
        createdAt: 1,
        expiresAt: 2,
        lastUsedAt: undefined,
      })),
    );
    const c = createRouteContext({ method: 'POST', body: { name: 'extra' } });
    await new CreateTokenRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('DELETE /user/tokens removes tokens and requires an id', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.delete).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'DELETE', body: { tokenId: 't1' } });
    await new DeleteTokenRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith({ success: true });

    const missing = createRouteContext({ method: 'DELETE', body: {} });
    await new DeleteTokenRoute({} as never).handle(missing as never);
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });
});
