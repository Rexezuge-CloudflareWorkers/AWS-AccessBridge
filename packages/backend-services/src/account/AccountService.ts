import { AwsAccountsDAO, RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AccessKeys, CredentialChain, RoleConfig } from '@aws-access-bridge/shared/model';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { AWS_ACCOUNT_ID_PATTERN } from '../access';
import { CredentialService, type CredentialServiceEnv } from '../credential';
import { IamService, type DiscoveredRole } from '../aws/iam';
import { StsService } from '../aws/sts';

interface AccountServiceEnv extends CredentialServiceEnv {
  AccessBridgeDB: D1Queryable;
}

class AccountService {
  private readonly credentials: CredentialService;
  private readonly sts: StsService;
  private readonly iam: IamService;

  constructor(
    private readonly env: AccountServiceEnv,
    sts?: StsService,
    iam?: IamService,
    credentials?: CredentialService,
  ) {
    this.sts = sts ?? new StsService();
    this.iam = iam ?? new IamService();
    this.credentials = credentials ?? new CredentialService(env, this.sts);
  }

  public async setNickname(awsAccountId: string, nickname: string): Promise<{ accountId: string; nickname: string }> {
    if (!awsAccountId || !nickname) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('Invalid AWS Account ID format. Must be exactly 12 digits.');
    }
    if (nickname.trim().length === 0) {
      throw new BadRequestError('Nickname cannot be empty.');
    }
    if (nickname.length > 255) {
      throw new BadRequestError('Nickname cannot exceed 255 characters.');
    }
    const accountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await accountsDAO.setAccountNickname(awsAccountId, nickname.trim());
    return { accountId: awsAccountId, nickname: nickname.trim() };
  }

  public async removeNickname(awsAccountId: string): Promise<{ accountId: string }> {
    if (!awsAccountId) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('Invalid AWS Account ID format. Must be exactly 12 digits.');
    }
    const accountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await accountsDAO.removeAccountNickname(awsAccountId);
    return { accountId: awsAccountId };
  }

  public async getRoleConfig(awsAccountId: string, roleName: string): Promise<RoleConfig | undefined> {
    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(this.env.AccessBridgeDB);
    return roleConfigsDAO.getRoleConfig(awsAccountId, roleName);
  }

  public async setRoleConfig(
    awsAccountId: string,
    roleName: string,
    destinationPath?: string,
    destinationRegion?: string,
    roleSessionDurationSeconds?: number,
  ): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);

    await accountsDAO.ensureAccountExists(awsAccountId);
    await roleConfigsDAO.setRoleConfig(awsAccountId, roleName, destinationPath, destinationRegion, roleSessionDurationSeconds);
  }

  public async deleteRoleConfig(awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(this.env.AccessBridgeDB);
    await roleConfigsDAO.deleteRoleConfig(awsAccountId, roleName);
  }

  public async listAccountRoles(principalArn: string): Promise<{ roles: DiscoveredRole[] }> {
    if (!principalArn) {
      throw new BadRequestError('Missing required field: principalArn.');
    }
    const credentialChain: CredentialChain = await this.credentials.getCredentialChain(principalArn);

    let credential: AccessKeys = {
      accessKeyId: credentialChain.accessKeyId,
      secretAccessKey: credentialChain.secretAccessKey,
      sessionToken: credentialChain.sessionToken,
    };

    for (let i = credentialChain.principalArns.length - 2; i >= 0; i--) {
      const roleArn: string = credentialChain.principalArns[i];
      credential = await this.sts.assumeRole(roleArn, credential, 'AccessBridge-RoleDiscovery');
    }

    const roles = await this.iam.listRoles(credential);
    return { roles };
  }
}

class AccountServiceFactory {
  public static create(env: AccountServiceEnv): AccountService {
    return new AccountService(env);
  }
}

export { AccountService, AccountServiceFactory };
export type { AccountServiceEnv };
