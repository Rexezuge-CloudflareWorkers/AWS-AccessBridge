
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class RemoveCredentialRelationshipRoute extends IAdminActivityAPIRoute<
  RemoveCredentialRelationshipRequest,
  RemoveCredentialRelationshipResponse,
  RemoveCredentialRelationshipEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Remove Credential Relationship',
    description:
      'Removes a credential relationship by deleting the entire credential record for the specified principal ARN. This operation removes both the relationship mapping and any associated AWS credentials from the database. Use this to clean up credential chains or remove obsolete role mappings. This operation is irreversible.',
    requestBody: {
      description: 'Principal ARN to remove',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'AWS principal ARN (IAM role or user) to remove from the credentials table',
                example: 'arn:aws:iam::123456789012:role/TargetRole',
                pattern: '^arn:aws:iam::[0-9]{12}:(role|user)/.+$',
              },
            },
          },
          examples: {
            'remove-role': {
              summary: 'Remove role from credential chain',
              description: 'Removes a role and its relationships from the credential system',
              value: {
                principalArn: 'arn:aws:iam::123456789012:role/DeveloperRole',
              },
            },
            'remove-user': {
              summary: 'Remove user from credential chain',
              description: 'Removes a user and its relationships from the credential system',
              value: {
                principalArn: 'arn:aws:iam::123456789012:user/ServiceUser',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully removed the credential relationship',
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
                  example: 'Credential relationship removed successfully',
                },
              },
            },
            examples: {
              'relationship-removed': {
                summary: 'Successful relationship removal',
                value: {
                  success: true,
                  message: 'Credential relationship removed successfully',
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Invalid request parameters - missing required fields or malformed ARN'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '500': internalServerErrorResponse('Internal server error during credential relationship removal'),
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleAdminRequest(
    request: RemoveCredentialRelationshipRequest,
    env: RemoveCredentialRelationshipEnv,
    _cxt: ActivityContext<RemoveCredentialRelationshipEnv>,
  ): Promise<RemoveCredentialRelationshipResponse> {
    await getRequestScope(_cxt).get(Tokens.CredentialStoreService).removeCredential(request.principalArn);

    return {
      success: true,
      message: 'Credential relationship removed successfully',
    };
  }
}

interface RemoveCredentialRelationshipRequest extends IRequest {
  principalArn: string;
}

interface RemoveCredentialRelationshipResponse extends IResponse {
  success: boolean;
  message: string;
}

interface RemoveCredentialRelationshipEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { RemoveCredentialRelationshipRoute };
export type { RemoveCredentialRelationshipRequest, RemoveCredentialRelationshipResponse };
