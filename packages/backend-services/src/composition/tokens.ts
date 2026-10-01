import type { Token } from '@aws-access-bridge/backend-runtime/di';
import type { ServiceEnv } from './ServiceEnv';
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
import type { UserIdentityService } from '../identity/UserIdentityService';
import type { CredentialService } from '../credential/CredentialService';
import type { CredentialChainService } from '../credential/CredentialChainService';
import type { CredentialStoreService } from '../credential/CredentialStoreService';
import type { MaintenanceService } from '../maintenance/MaintenanceService';
import type { ResourceService } from '../resource/ResourceService';
import type { TeamService } from '../team/TeamService';
import type { UserService } from '../user/UserService';

// Central token registry for the per-request composition root
// (`requestScope.ts`). Call sites resolve services via
// `getRequestScope(env).get(Tokens.CredentialService)`.
//
// Tokens carry their value type (`Token<T>`) so `scope.get(...)` infers the
// service type without an explicit generic at call sites.
type RequestScopeEnvShape = ServiceEnv;

const Tokens = {
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
  UserIdentityService: Symbol('UserIdentityService') as Token<UserIdentityService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
export type { RequestScopeEnvShape };
