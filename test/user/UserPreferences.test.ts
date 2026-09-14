import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '@aws-access-bridge/backend-services/user/UserService';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { GetCurrentUserRoute } from '@/endpoints/user/me/GET';
import { UpdateCurrentUserRoute } from '@/endpoints/user/me/PUT';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');

function serviceEnv() {
  return { AccessBridgeDB: {} } as never;
}

describe('UserService preferred language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes tags before storing them', async () => {
    const service = new UserService(serviceEnv());
    await service.updatePreferredLanguage('user@example.com', 'de_DE');
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', 'de');
  });

  it('maps bare zh to zh-CN and clears on null', async () => {
    const service = new UserService(serviceEnv());
    await service.updatePreferredLanguage('user@example.com', 'zh');
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', 'zh-CN');
    await service.updatePreferredLanguage('user@example.com', null);
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', null);
  });

  it('normalizes stored tags on read', async () => {
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(false);
    vi.mocked(UserMetadataDAO.prototype.getPreferredLanguage).mockResolvedValue('pt_BR');
    const service = new UserService(serviceEnv());
    await expect(service.getCurrentUser('user@example.com')).resolves.toMatchObject({ preferredLanguage: 'pt' });
  });
});

describe('user language routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /user/me normalizes stored language tags', async () => {
    vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(false);
    vi.mocked(UserMetadataDAO.prototype.getPreferredLanguage).mockResolvedValue('de_DE');
    const c = createRouteContext({ url: 'https://example.com/user/me' });
    await new GetCurrentUserRoute({} as never).handle(c as never);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ preferredLanguage: 'de' }));
  });

  it('PUT /user/me normalizes underscore tags', async () => {
    const c = createRouteContext({ method: 'PUT', body: { preferredLanguage: 'de_DE' }, url: 'https://example.com/user/me' });
    await new UpdateCurrentUserRoute({} as never).handle(c as never);
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', 'de');
    expect(c.json).toHaveBeenCalledWith({ success: true, preferredLanguage: 'de' });
  });

  it('PUT /user/me clears the preference on null', async () => {
    const c = createRouteContext({ method: 'PUT', body: { preferredLanguage: null }, url: 'https://example.com/user/me' });
    await new UpdateCurrentUserRoute({} as never).handle(c as never);
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).toHaveBeenCalledWith('user@example.com', null);
    expect(c.json).toHaveBeenCalledWith({ success: true, preferredLanguage: null });
  });

  it('PUT /user/me rejects unsupported languages with 400', async () => {
    const c = createRouteContext({ method: 'PUT', body: { preferredLanguage: 'xx' }, url: 'https://example.com/user/me' });
    await new UpdateCurrentUserRoute({} as never).handle(c as never);
    expect(UserMetadataDAO.prototype.updatePreferredLanguage).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });
});
