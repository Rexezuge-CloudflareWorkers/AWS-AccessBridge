import { AssumableRolesDAO, AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

interface AccessServiceEnv {
  AccessBridgeDB: D1Queryable;
}

class AccessService {
  constructor(private readonly env: AccessServiceEnv) {}

  public async grantAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('AWS Account ID must be exactly 12 digits.');
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await assumableRolesDAO.grantUserAccessToRole(userEmail, awsAccountId, roleName);
  }

  public async revokeAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!AWS_ACCOUNT_ID_PATTERN.test(awsAccountId)) {
      throw new BadRequestError('AWS Account ID must be exactly 12 digits.');
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await assumableRolesDAO.revokeUserAccessToRole(userEmail, awsAccountId, roleName);
  }
}

class AccessServiceFactory {
  public static create(env: AccessServiceEnv): AccessService {
    return new AccessService(env);
  }
}

export { AccessService, AccessServiceFactory, AWS_ACCOUNT_ID_PATTERN };
export type { AccessServiceEnv };
