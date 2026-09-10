import { CredentialsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@/constants';

class StoreCredentialRoute extends IAdminActivityAPIRoute<StoreCredentialRequest, StoreCredentialResponse, StoreCredentialEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Store AWS Credentials',
    description: 'Encrypts and stores AWS credentials in the database.',
    requestBody: {
      description: 'AWS credentials to store',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn', 'accessKeyId', 'secretAccessKey'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'AWS principal ARN',
              },
              accessKeyId: {
                type: 'string' as const,
                description: 'AWS access key ID',
              },
              secretAccessKey: {
                type: 'string' as const,
                description: 'AWS secret access key',
              },
              sessionToken: {
                type: 'string' as const,
                description: 'AWS session token (optional)',
              },
            },
          },
          examples: {
            'permanent-credentials': {
              summary: 'Store permanent AWS credentials',
              value: {
                principalArn: 'arn:aws:iam::123456789012:role/MyRole',
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              },
            },
            'temporary-credentials': {
              summary: 'Store temporary AWS credentials with session token',
              value: {
                principalArn: 'arn:aws:iam::123456789012:role/MyRole',
                accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully stored credentials',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['success', 'message'],
              properties: {
                success: {
                  type: 'boolean' as const,
                  example: true,
                },
                message: {
                  type: 'string' as const,
                  example: 'Credentials stored successfully',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Invalid request - missing required fields',
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
                      description: 'Details about the invalid request',
                      example: 'Missing required fields.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing authentication or invalid user',
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
        description: 'Internal server error during credential storage',
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
                      example: 'Failed to store credentials in database',
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
    request: StoreCredentialRequest,
    env: StoreCredentialEnv,
    _cxt: ActivityContext<StoreCredentialEnv>,
  ): Promise<StoreCredentialResponse> {
    if (!request.principalArn || !request.accessKeyId || !request.secretAccessKey) {
      throw new BadRequestError('Missing required fields.');
    }

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsDAO: CredentialsDAO = new CredentialsDAO(env.AccessBridgeDB, masterKey, principalTrustChainLimit);

    await credentialsDAO.storeCredential(request.principalArn, request.accessKeyId, request.secretAccessKey, request.sessionToken);

    return {
      success: true,
      message: 'Credentials stored successfully',
    };
  }
}

interface StoreCredentialRequest extends IRequest {
  principalArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

interface StoreCredentialResponse extends IResponse {
  success: boolean;
  message: string;
}

interface StoreCredentialEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string | undefined;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { StoreCredentialRoute };
export type { StoreCredentialRequest, StoreCredentialResponse };
