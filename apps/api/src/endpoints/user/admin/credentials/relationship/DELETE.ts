import { CredentialsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@/constants';

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
      '400': {
        description: 'Invalid request parameters - missing required fields or malformed ARN',
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
              'missing-principal-arn': {
                summary: 'Missing principal ARN',
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
        description: 'Internal server error during credential relationship removal',
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
                      example: 'Failed to remove credential relationship from database',
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
    request: RemoveCredentialRelationshipRequest,
    env: RemoveCredentialRelationshipEnv,
    _cxt: ActivityContext<RemoveCredentialRelationshipEnv>,
  ): Promise<RemoveCredentialRelationshipResponse> {
    if (!request.principalArn) {
      throw new BadRequestError('Missing required fields.');
    }

    // Basic ARN validation
    const arnPattern = /^arn:aws:iam::[0-9]{12}:(role|user)\/.+$/;
    if (!arnPattern.test(request.principalArn)) {
      throw new BadRequestError('Invalid principal ARN format.');
    }

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsDAO: CredentialsDAO = new CredentialsDAO(env.AccessBridgeDB, masterKey, principalTrustChainLimit);

    await credentialsDAO.removeCredential(request.principalArn);

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
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string | undefined;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { RemoveCredentialRelationshipRoute };
export type { RemoveCredentialRelationshipRequest, RemoveCredentialRelationshipResponse };
