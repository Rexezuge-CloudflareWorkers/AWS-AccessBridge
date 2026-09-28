import { AssumableRolesDAO, AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError } from '@aws-access-bridge/backend-errors';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService, idOf } from '../identity/UserIdentityService';

const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

type AccessServiceEnv = ServiceEnv;

class AccessService {
  private readonly identity: UserIdentityService;

  constructor(
    private readonly env: AccessServiceEnv,
    identity?: UserIdentityService,
  ) {
    this.identity = identity ?? new UserIdentityService(env);
  }

  public async grantAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('AWS Account ID must be exactly 12 digits.');
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await assumableRolesDAO.grantUserAccessToRole(
      { userId: idOf(account), anchorEmail: account?.anchorEmail ?? userEmail },
      awsAccountId,
      roleName,
    );
  }

  public async revokeAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('AWS Account ID must be exactly 12 digits.');
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    // No `ensureAccountExists` here: revoking access for an account that was
    // never granted would create a phantom `aws_accounts` row, which then shows
    // up in admin listings until orphan cleanup runs.
    const account = await this.identity.resolveAccount(userEmail);
    await assumableRolesDAO.revokeUserAccessToRole(
      { userId: idOf(account), anchorEmail: account?.anchorEmail ?? userEmail },
      awsAccountId,
      roleName,
    );
  }
}export { AccessService, AWS_ACCOUNT_ID_PATTERN };
export type { AccessServiceEnv };
