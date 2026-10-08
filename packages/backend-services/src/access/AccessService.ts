import { AssumableRolesDAO, AwsAccountsDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError } from '@aws-access-bridge/backend-errors';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';
import { AWS_ACCOUNT_ID_ERROR_MESSAGE, isAwsAccountId } from '@aws-access-bridge/shared/utils/aws';

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
    if (!isAwsAccountId(awsAccountId)) {
      throw new BadRequestError(AWS_ACCOUNT_ID_ERROR_MESSAGE);
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    const owner = await resolveOwner(this.identity, userEmail);
    // Materialize the account row before the grant: the grant and the rest of
    // that user's rows carry foreign keys to it, and D1 does not enforce those
    // by default, so a grant to a never-signed-in address would otherwise be an
    // assumables row pointing at nothing.
    await new UserMetadataDAO(this.env.AccessBridgeDB).ensureUserEmailExists(owner.anchorEmail);
    await accountsDAO.ensureAccountExists(awsAccountId);
    await assumableRolesDAO.grantUserAccessToRole(owner, awsAccountId, roleName);
  }

  public async revokeAccess(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!isAwsAccountId(awsAccountId)) {
      throw new BadRequestError(AWS_ACCOUNT_ID_ERROR_MESSAGE);
    }
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    // No `ensureAccountExists` here: revoking access for an account that was
    // never granted would create a phantom `aws_accounts` row, which then shows
    // up in admin listings until orphan cleanup runs.
    const owner = await resolveOwner(this.identity, userEmail);
    await assumableRolesDAO.revokeUserAccessToRole(owner, awsAccountId, roleName);
  }
}
export { AccessService };
export type { AccessServiceEnv };
