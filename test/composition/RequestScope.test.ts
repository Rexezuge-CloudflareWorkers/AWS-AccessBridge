import { describe, it, expect, vi } from 'vitest';
import { createRequestScope, getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';
import { InternalServerError } from '@aws-access-bridge/backend-errors';

function scopeEnv() {
  return {
    AccessBridgeDB: {},
    AccessBridgeKV: {},
    CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('master-key') },
  } as never;
}

describe('createRequestScope', () => {
  it('resolves every domain service from one composition root', () => {
    const scope = createRequestScope(scopeEnv());
    for (const token of [
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

  it('fetches each encryption key once per scope, and never the other one', async () => {
    const credential = vi.fn().mockResolvedValue('credential-key');
    const cache = vi.fn().mockResolvedValue('cache-key');
    const scope = createRequestScope({
      AccessBridgeDB: {},
      CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: credential },
      CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: cache },
    } as never);

    const chain = scope.get(Tokens.CredentialKey);
    await chain();
    await chain();
    expect(credential).toHaveBeenCalledTimes(1);
    // Resolving one key must not fetch the other.
    expect(cache).not.toHaveBeenCalled();

    await scope.get(Tokens.CredentialCacheKey)();
    expect(cache).toHaveBeenCalledTimes(1);
    expect(scope.get(Tokens.CollectorRegistry).getAll().size).toBe(5);
  });

  /**
   * Each surface's own key first, then the legacy master key so rows written
   * before the split still decrypt. `CREDENTIAL_ENCRYPTION_KEY_SECRET` is seeded
   * with the current master-key value at deploy time, which is what makes this a
   * rename plus a copy rather than a re-encryption.
   */
  it('orders the key chain own-key-first with the legacy master key as fallback', async () => {
    const scope = createRequestScope({
      AccessBridgeDB: {},
      CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('new-key') },
      CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('cache-key') },
      AES_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('legacy-key') },
    } as never);
    await expect(scope.get(Tokens.CredentialKey)()).resolves.toEqual(['new-key', 'legacy-key']);
    await expect(scope.get(Tokens.CredentialCacheKey)()).resolves.toEqual(['cache-key', 'legacy-key']);
  });

  it('deduplicates when the feature key and the legacy master key are the same value', async () => {
    // The usual state right after deploying the split: seeding the new binding
    // with the current master key means every decrypt would otherwise pay for a
    // second, guaranteed-to-fail attempt.
    const scope = createRequestScope(scopeEnv());
    await expect(scope.get(Tokens.CredentialKey)()).resolves.toEqual(['master-key']);
  });

  it('falls back to the raw var when no Secrets Store binding is present', async () => {
    // Local dev and the integration harness, where no Secrets Store is provisioned.
    const scope = createRequestScope({ AccessBridgeDB: {}, CREDENTIAL_ENCRYPTION_KEY: 'raw-key' } as never);
    await expect(scope.get(Tokens.CredentialKey)()).resolves.toEqual(['raw-key']);
  });

  it('resolves to a single key once the legacy master key is dropped', async () => {
    // The exit from the migration: requiring the legacy key would make it a one-way
    // door, so an absent one degrades to a one-element chain rather than throwing.
    const scope = createRequestScope({
      AccessBridgeDB: {},
      CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockResolvedValue('only-key') },
    } as never);
    await expect(scope.get(Tokens.CredentialKey)()).resolves.toEqual(['only-key']);
  });

  it('fails loudly when an encryption key is neither bound nor set as a var', async () => {
    const scope = createRequestScope({ AccessBridgeDB: {} } as never);
    await expect(scope.get(Tokens.CredentialKey)()).rejects.toThrow(InternalServerError);
    await expect(scope.get(Tokens.CredentialCacheKey)()).rejects.toThrow(InternalServerError);
  });

  it('does not let the raw var mask a broken Secrets Store binding', async () => {
    // The binding is declared, so it must be used — a failing production binding
    // has to fail loudly rather than silently falling back to a test var.
    const scope = createRequestScope({
      AccessBridgeDB: {},
      CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: vi.fn().mockRejectedValue(new Error('secrets store down')) },
      CREDENTIAL_ENCRYPTION_KEY: 'raw-key',
    } as never);
    await expect(scope.get(Tokens.CredentialKey)()).rejects.toThrow('secrets store down');
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

  /**
   * Regression: the cache was keyed on `env`, but no caller actually passed that
   * object through — `withUnconstrainedD1Session` spreads `c.env` into a *new*
   * object and the audit middleware passed an inline
   * `{ AccessBridgeDB: c.env.AccessBridgeDB }` literal. So the `WeakMap` missed on
   * every request, building two or three containers where there should be one:
   * two or three secret fetches, and the `UserIdentityService` address→account memo
   * re-running the same resolution two or three times.
   *
   * Request handlers therefore key on the Hono *context*, which is genuinely one
   * object per request and reaches the handler whether or not `env` was copied.
   */
  it('shares one scope across every handler of a request, even when env is copied', () => {
    const env = scopeEnv();
    // Two "handlers" of the same request: one sees the raw env, the other a
    // session-wrapped spread copy, exactly as the middleware and routes did.
    const first = { env };
    const second = { env: { ...env, AccessBridgeDB: { prepare: () => undefined } } };

    const scope = getRequestScope(first);
    expect(getRequestScope(second)).not.toBe(scope);

    // The context, however, is stable for the request.
    const context = { env };
    expect(getRequestScope(context)).toBe(getRequestScope(context));
    expect(getRequestScope(context).get(Tokens.TeamService)).toBe(getRequestScope(context).get(Tokens.TeamService));
  });

  it('keeps the context and env caches separate', () => {
    // Same env, two keying strategies: a context-keyed scope must not be handed to
    // a caller that passed the env, or the per-request memo would outlive its
    // request.
    const env = scopeEnv();
    expect(getRequestScope({ env })).not.toBe(getRequestScope(env));
  });

  it('fetches the encryption keys once per request scope, not once per call', async () => {
    const credential = vi.fn().mockResolvedValue('k');
    const context = { env: { ...scopeEnv(), CREDENTIAL_ENCRYPTION_KEY_SECRET: { get: credential } } as never };
    await getRequestScope(context).get(Tokens.CredentialKey)();
    await getRequestScope(context).get(Tokens.CredentialKey)();
    expect(credential).toHaveBeenCalledTimes(1);
  });

  it('injects the same memoized keys into the credential services', async () => {
    // The services hold only `env`, which is not the request's identity, so the
    // composition root passes the keys in rather than letting them look a scope up.
    const get = vi.fn().mockResolvedValue('k');
    const scope = createRequestScope({ ...scopeEnv(), CREDENTIAL_ENCRYPTION_KEY_SECRET: { get } } as never);
    const store = scope.get(Tokens.CredentialStoreService);
    await store.createCredentialsDAO();
    await store.createCredentialsDAO();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
