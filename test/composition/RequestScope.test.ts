import { describe, it, expect, vi } from 'vitest';
import { createRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

function scopeEnv() {
  return {
    AccessBridgeDB: {},
    AccessBridgeKV: {},
    AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  } as never;
}

describe('createRequestScope', () => {
  it('resolves every domain service from one composition root', () => {
    const scope = createRequestScope(scopeEnv());
    for (const token of [
      Tokens.CredentialService,
      Tokens.CredentialChainService,
      Tokens.CredentialStoreService,
      Tokens.AssumeRoleService,
      Tokens.ConsoleService,
      Tokens.StsService,
      Tokens.IamService,
      Tokens.CostExplorerService,
      Tokens.CostService,
      Tokens.ResourceService,
      Tokens.TeamService,
      Tokens.UserService,
      Tokens.AccessService,
      Tokens.AccountService,
      Tokens.MaintenanceService,
      Tokens.AuditService,
      Tokens.TokenService,
      Tokens.AccessAuthService,
    ]) {
      expect(scope.get(token)).toBeTruthy();
    }
  });

  it('memoizes the master key across services', async () => {
    const get = vi.fn().mockResolvedValue('master-key');
    const scope = createRequestScope({ AccessBridgeDB: {}, AES_ENCRYPTION_KEY_SECRET: { get } } as never);
    const key = scope.get(Tokens.MasterKey);
    await key();
    await key();
    expect(get).toHaveBeenCalledTimes(1);
    expect(scope.get(Tokens.CollectorRegistry).getAll().size).toBe(5);
  });
});
