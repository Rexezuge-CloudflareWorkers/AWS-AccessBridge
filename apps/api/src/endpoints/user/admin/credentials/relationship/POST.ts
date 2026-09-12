import { CredentialServiceFactory } from '@aws-access-bridge/backend-services/credential';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
      '400': {
        description: 'Invalid request parameters - missing required fields or malformed ARNs',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'BadRequestError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Details about the invalid request parameters',
                      example: 'Missing required fields.',
                    },
                  },
                },
              },
            },
            examples: {
              'missing-fields': {
                summary: 'Missing required fields',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Missing required fields.',
                  },
                },
              },
              'invalid-principal-arn': {
                summary: 'Invalid principal ARN format',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Invalid principal ARN format.',
                  },
                },
              },
              'invalid-assumed-by-arn': {
                summary: 'Invalid assumedBy ARN format',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Invalid assumedBy ARN format.',
                  },
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid Cloudflare Access authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'UnauthorizedError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Authentication error details',
                      example: 'No Cloudflare Access JWT token provided in request headers.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error during credential relationship storage',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'InternalServerError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Error description',
                      example: 'Failed to store credential relationship in database',
                    },
                  },
                },
              },
            },
          },
        },
      },
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
    await CredentialServiceFactory.create(env).storeCredentialRelationship(request.principalArn, request.assumedBy);

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
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { StoreCredentialRelationshipRoute };
export type { StoreCredentialRelationshipRequest, StoreCredentialRelationshipResponse };
