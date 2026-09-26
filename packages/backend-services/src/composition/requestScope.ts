import { Container } from '@aws-access-bridge/backend-runtime/di';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
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
import { CredentialService } from '../credential/CredentialService';
import { CredentialStoreService } from '../credential/CredentialStoreService';
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
 * Declared `async` so a throw inside `fn` becomes a rejection: `Tokens.MasterKey`
 * is typed `() => Promise<string>`, and a synchronous throw would slip past a
 * caller's `.catch()` and surface as an unhandled error instead. The rejected
 * promise is cached too, so a failing binding is not retried per lookup.
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

// Composition root: builds a per-request scope wiring env → services. This is
// the single place services are constructed; every caller goes through
// `getRequestScope(env)` so a request shares one set of instances.
function createRequestScope(env: RequestScopeEnvShape): Container {
  const scope = new Container();
  scope.bindValue(Tokens.Env, env);
  scope.bindValue(Tokens.Db, env.AccessBridgeDB);

  const masterKey = memoize(() => {
    if (!env.AES_ENCRYPTION_KEY_SECRET) {
      throw new InternalServerError('Credential encryption key is not configured for this environment.');
    }
    return env.AES_ENCRYPTION_KEY_SECRET.get();
  });
  scope.bindValue(Tokens.MasterKey, masterKey);
  scope.bindValue(Tokens.CollectorRegistry, InjectableCollectorRegistry.withDefaults());

  scope.bind(Tokens.StsService, () => new StsService());
  scope.bind(Tokens.IamService, () => new IamService());
  scope.bind(Tokens.CostExplorerService, () => new CostExplorerService());
  scope.bind(Tokens.ConsoleService, () => new ConsoleService());
  scope.bind(Tokens.CredentialChainService, () => new CredentialChainService(env));
  scope.bind(Tokens.CredentialStoreService, () => new CredentialStoreService(env));
  scope.bind(Tokens.CredentialService, () => new CredentialService(env));
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

  return scope;
}

/**
 * Per-env scope cache.
 *
 * Workers hand the same `env` object to every handler in a request, so keying
 * on it gives one scope — and therefore one set of service instances, one
 * `AES_ENCRYPTION_KEY_SECRET.get()`, one collector registry — per request, and
 * nothing is retained across requests.
 */
const scopesByEnv = new WeakMap<object, Container>();

/**
 * Resolve the service scope for `env`, creating it on first use.
 *
 * Production call sites use `getRequestScope(env).get(Tokens.X)`. Previously
 * each route did `XServiceFactory.create(env)`, which constructed a fresh
 * service — and re-fetched `AES_ENCRYPTION_KEY_SECRET` — on every call.
 */
function getRequestScope(env: RequestScopeEnvShape): Container {
  const cached: Container | undefined = scopesByEnv.get(env);
  if (cached) {
    return cached;
  }
  const scope: Container = createRequestScope(env);
  scopesByEnv.set(env, scope);
  return scope;
}

export { createRequestScope, getRequestScope };


export {type RequestScopeEnvShape} from './tokens';