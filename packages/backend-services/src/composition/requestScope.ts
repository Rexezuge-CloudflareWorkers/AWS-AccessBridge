import { Container } from '@aws-access-bridge/backend-runtime/di';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import { createEncryptionKeys, keyChain } from './encryptionKeys';
import { AccessService } from '../access/AccessService';
import { AccountService } from '../account/AccountService';
import { AssumeRoleService } from '../aws/assume-role/AssumeRoleService';
import { ConsoleService } from '../aws/console/ConsoleService';
import { CostExplorerService } from '../aws/ce/CostExplorerService';
import { IamService } from '../aws/iam/IamService';
import { StsService } from '../aws/sts/StsService';
import { InjectableCollectorRegistry } from '../aws/collectors/InjectableCollectorRegistry';
import { AuditService } from '../audit/AuditService';
import { AccessAuthService } from '../auth/AccessAuthService';
import { TokenService } from '../auth/TokenService';
import { CostService } from '../cost/CostService';
import { CredentialChainService } from '../credential/CredentialChainService';
import { CredentialStoreService } from '../credential/CredentialStoreService';
import { UserIdentityService } from '../identity/UserIdentityService';
import { MaintenanceService } from '../maintenance/MaintenanceService';
import { ResourceService } from '../resource/ResourceService';
import { TeamService } from '../team/TeamService';
import { UserService } from '../user/UserService';
import { Tokens } from './tokens';
import type { RequestScopeEnvShape } from './tokens';

/**
 * Cache a promise for the lifetime of the scope, so a secret fetch happens once
 * per request rather than once per service.
 *
 * Declared `async` so a throw inside `fn` becomes a rejection: the encryption-key
 * tokens are typed `() => Promise<string[]>`, and a synchronous throw would slip
 * past a caller's `.catch()` and surface as an unhandled error instead. The
 * rejected promise is cached too, so a failing binding is not retried per lookup.
 */
function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return async () => (pending ??= fn());
}

// `ServiceEnv.AccessBridgeKV` is optional because several services do not need
// it and the binding is not present in every environment, but chain walking and
// the credential cache cannot work without it. Narrow once, here, with an
// explicit error — a silent `undefined` would surface much later as a
// confusing failure inside STS assume-role.
function requireCredentialCacheKv(env: RequestScopeEnvShape): KVNamespace {
  if (!env.AccessBridgeKV) {
    throw new InternalServerError('The AccessBridgeKV binding is required for credential chain resolution but is not configured.');
  }
  return env.AccessBridgeKV;
}

/**
 * Composition root: builds a scope wiring env -> services. This is the single
 * place services are constructed; every caller reaches it through
 * `getRequestScope`.
 */
function createRequestScope(env: RequestScopeEnvShape): Container {
  const scope = new Container();

  // Per-feature encryption keys. Each resolves to the key chain for its surface
  // and is memoized, so resolving one key never fetches another and a failing binding
  // is not retried per lookup.
  const keys = createEncryptionKeys(env);
  const credentialKey = memoize(() => keyChain(keys.credentialKey));
  const credentialCacheKey = memoize(() => keyChain(keys.credentialCacheKey));
  scope.bindValue(Tokens.CredentialKey, credentialKey);
  scope.bindValue(Tokens.CredentialCacheKey, credentialCacheKey);
  scope.bindValue(Tokens.CollectorRegistry, InjectableCollectorRegistry.withDefaults());

  scope.bind(Tokens.StsService, () => new StsService());
  scope.bind(Tokens.IamService, () => new IamService());
  scope.bind(Tokens.CostExplorerService, () => new CostExplorerService());
  scope.bind(Tokens.ConsoleService, () => new ConsoleService());
  // The key providers are injected rather than looked up: these services hold only
  // `env`, which is not the request's identity, so a lookup inside one would build
  // a second scope and fetch the secrets again.
  const keyProvider = async (): Promise<{ credentials: readonly string[]; cache: readonly string[] }> => ({
    credentials: await credentialKey(),
    cache: await credentialCacheKey(),
  });
  scope.bind(Tokens.CredentialChainService, () => new CredentialChainService(env, undefined, keyProvider));
  scope.bind(Tokens.CredentialStoreService, () => new CredentialStoreService(env, undefined, () => credentialKey()));
  scope.bind(Tokens.AssumeRoleService, () => new AssumeRoleService({ ...env, AccessBridgeKV: requireCredentialCacheKv(env) }));
  scope.bind(Tokens.CostService, () => new CostService(env));
  scope.bind(Tokens.ResourceService, () => new ResourceService(env));
  scope.bind(Tokens.TeamService, () => new TeamService(env));
  scope.bind(Tokens.UserService, () => new UserService(env));
  scope.bind(Tokens.AccessService, () => new AccessService(env));
  scope.bind(Tokens.AccountService, () => new AccountService(env));
  scope.bind(Tokens.MaintenanceService, () => new MaintenanceService(env));
  scope.bind(Tokens.AuditService, () => new AuditService(env));
  scope.bind(Tokens.TokenService, () => new TokenService(env));
  scope.bind(Tokens.AccessAuthService, () => new AccessAuthService(env));
  // One instance per request scope, which is what makes the address -> account
  // memo in `UserIdentityService` a per-request cache rather than a leak.
  scope.bind(Tokens.UserIdentityService, () => new UserIdentityService(env));

  return scope;
}

/**
 * Scope caches, one per keying strategy. Both are `WeakMap`s, so nothing is
 * retained beyond the lifetime of the key.
 */
const scopesByContext = new WeakMap<object, Container>();
const scopesByEnv = new WeakMap<object, Container>();

/**
 * The composition scope for the current unit of work.
 *
 * Accepts either a Hono context or a bare env, because the two callers have
 * genuinely different identities available:
 *
 * - **Request handlers** pass the context. Keying on `env` looked right — Workers
 *   hand the same object to every handler in a request — but nothing passed that
 *   object through: `withUnconstrainedD1Session` spreads `c.env` into a *new*
 *   object, so an env-keyed lookup missed on every request, building two or three
 *   containers where there should be one. That cost two or three secret fetches
 *   instead of one and defeated the `UserIdentityService` address-to-account memo.
 *   The context is genuinely one object per request and reaches the handler
 *   whether or not `env` was copied.
 * - **Cron and Durable Object tasks** pass `env` directly; there is no context
 *   object to key on.
 */
function getRequestScope<TEnv extends RequestScopeEnvShape>(source: TEnv | { env: TEnv }): Container {
  const isContext: boolean = 'env' in (source as object);
  const cache: WeakMap<object, Container> = isContext ? scopesByContext : scopesByEnv;
  // Both shapes are their own cache key — a context and an env are different
  // objects, which is exactly why they need different maps.
  const key: object = source;

  const cached: Container | undefined = cache.get(key);
  if (cached) {
    return cached;
  }
  const scope: Container = createRequestScope(isContext ? (source as { env: TEnv }).env : (source as TEnv));
  cache.set(key, scope);
  return scope;
}

export { createRequestScope, getRequestScope };
export type { RequestScopeEnvShape } from './tokens';
