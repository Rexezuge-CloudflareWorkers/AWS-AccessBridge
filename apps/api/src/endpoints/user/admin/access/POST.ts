import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class GrantAccessRoute extends IAdminActivityAPIRoute<GrantAccessRequest, GrantAccessResponse, GrantAccessEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Grant User Access to Role',
    description:
      'Grants a user permission to assume a specific AWS role in an account. This creates a mapping in the assumable_roles table that allows the specified user to assume the role through the AWS Access Bridge. If the AWS account does not exist in the database, it will be created automatically. If userEmail is not provided, access is granted to the current admin user. This operation is idempotent - granting access to a role that a user already has access to will not cause an error.',
    requestBody: {
      description: 'User access details to grant',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'roleName'],
            properties: {
              userEmail: {
                type: 'string' as const,
                format: 'email',
                description: 'Email address of the user to grant access to (optional - defaults to current admin user)',
                example: 'developer@example.com',
                maxLength: 120,
              },
              awsAccountId: {
                type: 'string' as const,
                pattern: '^[0-9]{12}$',
                description: 'AWS Account ID (exactly 12 digits)',
                example: '123456789012',
              },
              roleName: {
                type: 'string' as const,
                description: 'Name of the AWS IAM role (without ARN prefix)',
                example: 'DeveloperRole',
                maxLength: 128,
                minLength: 1,
              },
            },
          },
          examples: {
            'grant-self-access': {
              summary: 'Grant access to current admin user',
              description: 'Grants access to the current admin user when no userEmail is specified',
              value: {
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'grant-developer-access': {
              summary: 'Grant developer access to a role',
              description: 'Allows a developer to assume a development role in a specific AWS account',
              value: {
                userEmail: 'developer@example.com',
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'grant-admin-access': {
              summary: 'Grant admin access to a role',
              description: 'Allows an administrator to assume an admin role in a production account',
              value: {
                userEmail: 'admin@example.com',
                awsAccountId: '987654321098',
                roleName: 'AdminRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully granted user access to the specified role',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['success', 'message'],
              properties: {
                success: {
                  type: 'boolean' as const,
                  description: 'Indicates if the operation was successful',
                  example: true,
                },
                message: {
                  type: 'string' as const,
                  description: 'Human-readable success message',
                  example: 'Access granted successfully',
                },
              },
            },
            examples: {
              'access-granted': {
                summary: 'Successful access grant',
                value: {
                  success: true,
                  message: 'Access granted successfully',
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Invalid request parameters - missing required fields or malformed data'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '500': internalServerErrorResponse('Internal server error during access grant operation'),
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleAdminRequest(
    request: GrantAccessRequest,
    env: GrantAccessEnv,
    cxt: ActivityContext<GrantAccessEnv>,
  ): Promise<GrantAccessResponse> {
    const userEmail: string = request.userEmail || this.getAuthenticatedUserEmailAddress(cxt);
    await getRequestScope(cxt).get(Tokens.AccessService).grantAccess(userEmail, request.awsAccountId, request.roleName);
    return {
      success: true,
      message: 'Access granted successfully',
    };
  }
}

interface GrantAccessRequest extends IRequest {
  userEmail?: string;
  awsAccountId: string;
  roleName: string;
}

interface GrantAccessResponse extends IResponse {
  success: boolean;
  message: string;
}

type GrantAccessEnv = IAdminEnv;

export { GrantAccessRoute };
