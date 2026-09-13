import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { Token } from '@aws-access-bridge/backend-runtime/di';
import type { AccessService } from '../access/AccessService';
import type { AccountService } from '../account/AccountService';
import type { AssumeRoleService } from '../aws/assume-role/AssumeRoleService';
import type { ConsoleService } from '../aws/console/ConsoleService';
import type { CostExplorerService } from '../aws/ce/CostExplorerService';
import type { IamService } from '../aws/iam/IamService';
import type { StsService } from '../aws/sts/StsService';
import type { InjectableCollectorRegistry } from '../aws/collectors/InjectableCollectorRegistry';
import type { AuditService } from '../audit/AuditService';
import type { AccessAuthService } from '../auth/AccessAuthService';
import type { TokenService } from '../auth/TokenService';
import type { CostService } from '../cost/CostService';
import type { CredentialService } from '../credential/CredentialService';
import type { CredentialChainService } from '../credential/CredentialChainService';
import type { CredentialStoreService } from '../credential/CredentialStoreService';
import type { MaintenanceService } from '../maintenance/MaintenanceService';
import type { ResourceService } from '../resource/ResourceService';
import type { TeamService } from '../team/TeamService';
import type { UserService } from '../user/UserService';

// Central token registry for the per-request composition root
// (`requestScope.ts`). Call sites resolve services via
// `scope.get(Tokens.CredentialService)` instead of
// `CredentialServiceFactory.create(env)`.
//
// Tokens carry their value type (`Token<T>`) so `scope.get(...)` infers the
// service type without an explicit generic at call sites.
interface RequestScopeEnvShape {
  AccessBridgeDB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  AccessBridgeKV?: KVNamespace;
  [key: string]: unknown;
}

const Tokens = {
  Env: Symbol('Env') as Token<RequestScopeEnvShape>,
  Db: Symbol('Db') as Token<D1Queryable>,
  MasterKey: Symbol('MasterKey') as Token<() => Promise<string>>,
  CollectorRegistry: Symbol('CollectorRegistry') as Token<InjectableCollectorRegistry>,
  CredentialService: Symbol('CredentialService') as Token<CredentialService>,
  CredentialChainService: Symbol('CredentialChainService') as Token<CredentialChainService>,
  CredentialStoreService: Symbol('CredentialStoreService') as Token<CredentialStoreService>,
  AssumeRoleService: Symbol('AssumeRoleService') as Token<AssumeRoleService>,
  ConsoleService: Symbol('ConsoleService') as Token<ConsoleService>,
  StsService: Symbol('StsService') as Token<StsService>,
  IamService: Symbol('IamService') as Token<IamService>,
  CostExplorerService: Symbol('CostExplorerService') as Token<CostExplorerService>,
  CostService: Symbol('CostService') as Token<CostService>,
  ResourceService: Symbol('ResourceService') as Token<ResourceService>,
  TeamService: Symbol('TeamService') as Token<TeamService>,
  UserService: Symbol('UserService') as Token<UserService>,
  AccessService: Symbol('AccessService') as Token<AccessService>,
  AccountService: Symbol('AccountService') as Token<AccountService>,
  MaintenanceService: Symbol('MaintenanceService') as Token<MaintenanceService>,
  AuditService: Symbol('AuditService') as Token<AuditService>,
  TokenService: Symbol('TokenService') as Token<TokenService>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
export type { RequestScopeEnvShape };
