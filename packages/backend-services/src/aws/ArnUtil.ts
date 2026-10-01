import { AWS_ACCOUNT_ID_PATTERN } from '@aws-access-bridge/shared/schema';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

/**
The IAM resource-type segment that marks a role ARN, including its separator.
*/
const ROLE_RESOURCE_PREFIX: string = 'role/';

class ArnUtil {
  public static getAccountIdFromArn(arn: string): string {
    const arnParts = arn.split(':');
    if (arnParts.length < 6) {
      throw new BadRequestError('Invalid ARN format');
    }

    const accountId = arnParts[4];

    if (!accountId || !AWS_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw new BadRequestError('Invalid AWS Account ID');
    }

    return accountId;
  }

  /**
   * The IAM role name from a role ARN, path included.
   *
   * `role/path/To/MyRole` yields `path/To/MyRole`. The path is part of the role's
   * identity in IAM and appears in `assumable_roles.role_name`, so stripping it
   * would make a pathed role un-assumable — and, worse, hand the authorization
   * check a *different* role name than the one actually being assumed.
   */
  public static getRoleNameFromArn(arn: string): string {
    // ARN format: arn:partition:service:region:account-id:resource-type[/resource-path/]resource-name
    // IAM Role ARN example: arn:aws:iam::123456789012:role/YourRoleName
    const arnParts = arn.split(':');
    if (arnParts.length < 6 || !arnParts[5].startsWith(ROLE_RESOURCE_PREFIX)) {
      throw new BadRequestError('Invalid IAM Role ARN format');
    }

    const roleName = arnParts[5].slice(ROLE_RESOURCE_PREFIX.length);

    if (!roleName) {
      throw new BadRequestError('Role name not found in ARN');
    }

    return roleName;
  }
}

export { ArnUtil };
