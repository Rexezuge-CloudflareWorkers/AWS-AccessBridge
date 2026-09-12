import { BadRequestError } from '@aws-access-bridge/backend-errors';

class ArnUtil {
  public static getAccountIdFromArn(arn: string): string {
    const arnParts = arn.split(':');
    if (arnParts.length < 6) {
      throw new BadRequestError('Invalid ARN format');
    }

    const accountId = arnParts[4];

    if (!/^\d{12}$/.test(accountId)) {
      throw new BadRequestError('Invalid AWS Account ID');
    }

    return accountId;
  }

  public static getRoleNameFromArn(arn: string): string {
    // ARN format: arn:partition:service:region:account-id:resource-type/resource-name
    // IAM Role ARN example: arn:aws:iam::123456789012:role/YourRoleName
    const arnParts = arn.split(':');
    if (arnParts.length < 6 || !arnParts[5].startsWith('role/')) {
      throw new BadRequestError('Invalid IAM Role ARN format');
    }

    const resourcePart = arnParts[5]; // e.g., "role/YourRoleName"
    const roleName = resourcePart.split('/', 2)[1];

    if (!roleName) {
      throw new BadRequestError('Role name not found in ARN');
    }

    return roleName;
  }
}

export { ArnUtil };
