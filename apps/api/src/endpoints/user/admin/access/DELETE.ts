
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class RevokeAccessRoute extends IAdminActivityAPIRoute<RevokeAccessRequest, RevokeAccessResponse, RevokeAccessEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Revoke User Access to Role',
    description:
      "Revokes a user's permission to assume a specific AWS role in an account. This removes the mapping from the assumable_roles table, preventing the user from assuming the role through the AWS Access Bridge. If the AWS account does not exist in the database, it will be created automatically (though this is primarily for consistency). If userEmail is not provided, access is revoked from the current admin user. This operation is idempotent - revoking access from a role that a user doesn't have access to will not cause an error.",
    requestBody: {
      description: 'User access details to revoke',
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
                description: 'Email address of the user to revoke access from (optional - defaults to current admin user)',
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
                description: 'Name of the AWS IAM role to revoke access from (without ARN prefix)',
                example: 'DeveloperRole',
                maxLength: 128,
                minLength: 1,
              },
            },
          },
          examples: {
            'revoke-self-access': {
              summary: 'Revoke access from current admin user',
              description: 'Revokes access from the current admin user when no userEmail is specified',
              value: {
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'revoke-developer-access': {
              summary: 'Revoke developer access from a role',
              description: "Removes a developer's ability to assume a development role in a specific AWS account",
              value: {
                userEmail: 'developer@example.com',
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'revoke-contractor-access': {
              summary: 'Revoke contractor access from a role',
              description: "Removes a contractor's access when their engagement ends",
              value: {
                userEmail: 'contractor@external.com',
                awsAccountId: '987654321098',
                roleName: 'ContractorRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully revoked user access from the specified role',
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
                  example: 'Access revoked successfully',
                },
              },
            },
            examples: {
              'access-revoked': {
                summary: 'Successful access revocation',
                value: {
                  success: true,
                  message: 'Access revoked successfully',
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Invalid request parameters - missing required fields or malformed data'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '500': internalServerErrorResponse('Internal server error during access revocation operation'),
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleAdminRequest(
    request: RevokeAccessRequest,
    env: RevokeAccessEnv,
    cxt: ActivityContext<RevokeAccessEnv>,
  ): Promise<RevokeAccessResponse> {
    const userEmail: string = request.userEmail || this.getAuthenticatedUserEmailAddress(cxt);
    await getRequestScope(cxt).get(Tokens.AccessService).revokeAccess(userEmail, request.awsAccountId, request.roleName);
    return {
      success: true,
      message: 'Access revoked successfully',
    };
  }
}

interface RevokeAccessRequest extends IRequest {
  userEmail?: string;
  awsAccountId: string;
  roleName: string;
}

interface RevokeAccessResponse extends IResponse {
  success: boolean;
  message: string;
}

type RevokeAccessEnv = IAdminEnv;

export { RevokeAccessRoute };
export type { RevokeAccessRequest, RevokeAccessResponse };
