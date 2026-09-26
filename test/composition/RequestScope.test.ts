import { describe, it, expect, vi } from 'vitest';
import { createRequestScope, getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';
import { InternalServerError } from '@aws-access-bridge/backend-errors';

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

  it('fails loudly when the encryption key binding is missing', async () => {
    const scope = createRequestScope({ AccessBridgeDB: {} } as never);
    await expect(scope.get(Tokens.MasterKey)()).rejects.toThrow(InternalServerError);
  });

  it('fails loudly when the credential cache KV binding is missing', () => {
    // AssumeRoleService needs AccessBridgeKV; narrowing it silently to undefined
    // would fail much later inside STS assume-role with a confusing error.
    const scope = createRequestScope({ AccessBridgeDB: {} } as never);
    expect(() => scope.get(Tokens.AssumeRoleService)).toThrow(InternalServerError);
  });
});

describe('getRequestScope', () => {
  it('returns the same scope for the same env, so a request shares services', () => {
    const env = scopeEnv();
    const first = getRequestScope(env);
    expect(getRequestScope(env)).toBe(first);
    expect(first.get(Tokens.TeamService)).toBe(first.get(Tokens.TeamService));
  });

  it('does not share services across different env objects', () => {
    expect(getRequestScope(scopeEnv())).not.toBe(getRequestScope(scopeEnv()));
  });
});
