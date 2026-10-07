
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class StoreCredentialRelationshipRoute extends IAdminActivityAPIRoute<
  StoreCredentialRelationshipRequest,
  StoreCredentialRelationshipResponse,
  StoreCredentialRelationshipEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Store Credential Relationship',
    description:
      'Stores a credential relationship mapping between a principal ARN and the ARN it is assumed by. This creates a trust chain without storing actual AWS credentials, allowing the system to understand role assumption hierarchies. The relationship is used for building credential chains during role assumption operations.',
    requestBody: {
      description: 'Credential relationship details',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn', 'assumedBy'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'AWS principal ARN (IAM role or user) that can be assumed',
                example: 'arn:aws:iam::123456789012:role/TargetRole',
                pattern: '^arn:aws:iam::[0-9]{12}:(role|user)/.+$',
              },
              assumedBy: {
                type: 'string' as const,
                description: 'AWS principal ARN that assumes the target principal',
                example: 'arn:aws:iam::123456789012:role/IntermediateRole',
                pattern: '^arn:aws:iam::[0-9]{12}:(role|user)/.+$',
              },
            },
          },
          examples: {
            'role-chain': {
              summary: 'Create role assumption chain',
              description: 'Maps a target role to be assumed by an intermediate role',
              value: {
                principalArn: 'arn:aws:iam::123456789012:role/DeveloperRole',
                assumedBy: 'arn:aws:iam::123456789012:role/IntermediateRole',
              },
            },
            'cross-account-chain': {
              summary: 'Create cross-account role chain',
              description: 'Maps a role in one account to be assumed by a role in another account',
              value: {
                principalArn: 'arn:aws:iam::987654321098:role/ProductionRole',
                assumedBy: 'arn:aws:iam::123456789012:role/CrossAccountRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully stored the credential relationship',
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
                  example: 'Credential relationship stored successfully',
                },
              },
            },
            examples: {
              'relationship-stored': {
                summary: 'Successful relationship storage',
                value: {
                  success: true,
                  message: 'Credential relationship stored successfully',
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Invalid request parameters - missing required fields or malformed ARNs'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '500': internalServerErrorResponse('Internal server error during credential relationship storage'),
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleAdminRequest(
    request: StoreCredentialRelationshipRequest,
    env: StoreCredentialRelationshipEnv,
    _cxt: ActivityContext<StoreCredentialRelationshipEnv>,
  ): Promise<StoreCredentialRelationshipResponse> {
    await getRequestScope(_cxt).get(Tokens.CredentialStoreService).storeCredentialRelationship(request.principalArn, request.assumedBy);

    return {
      success: true,
      message: 'Credential relationship stored successfully',
    };
  }
}

interface StoreCredentialRelationshipRequest extends IRequest {
  principalArn: string;
  assumedBy: string;
}

interface StoreCredentialRelationshipResponse extends IResponse {
  success: boolean;
  message: string;
}

interface StoreCredentialRelationshipEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { StoreCredentialRelationshipRoute };
export type { StoreCredentialRelationshipRequest, StoreCredentialRelationshipResponse };
