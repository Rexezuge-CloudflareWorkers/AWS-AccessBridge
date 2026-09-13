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

function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}

// Composition root: builds a per-request child scope wiring env → services.
// Replaces the 12 scattered `XFactory.create(env)` call sites in apps/api
// and apps/background. `*Factory.create(env)` delegates here for
// backwards compatibility during migration.
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
  scope.bind(Tokens.CredentialChainService, () => new CredentialChainService(env as never));
  scope.bind(Tokens.CredentialStoreService, () => new CredentialStoreService(env as never));
  scope.bind(Tokens.CredentialService, () => new CredentialService(env as never));
  scope.bind(Tokens.AssumeRoleService, () => new AssumeRoleService(env as never));
  scope.bind(Tokens.CostService, () => new CostService(env as never));
  scope.bind(Tokens.ResourceService, () => new ResourceService(env as never));
  scope.bind(Tokens.TeamService, () => new TeamService(env as never));
  scope.bind(Tokens.UserService, () => new UserService(env as never));
  scope.bind(Tokens.AccessService, () => new AccessService(env as never));
  scope.bind(Tokens.AccountService, () => new AccountService(env as never));
  scope.bind(Tokens.MaintenanceService, () => new MaintenanceService(env as never));
  scope.bind(Tokens.AuditService, () => new AuditService(env as never));
  scope.bind(Tokens.TokenService, () => new TokenService(env as never));
  scope.bind(Tokens.AccessAuthService, () => new AccessAuthService(env as never));

  return scope;
}

/**
 * Generic factory helper killing the 12× identical
 * `*Factory.create(env) => new *Service(env)` boilerplate.
 * New services use `createService(Ctor, env)`; existing `*Factory`
 * classes delegate to it.
 */
function createService<T>(Ctor: new (env: RequestScopeEnvShape) => T, env: RequestScopeEnvShape): T {
  return new Ctor(env);
}

export { createRequestScope, createService };


export {type RequestScopeEnvShape} from './tokens';