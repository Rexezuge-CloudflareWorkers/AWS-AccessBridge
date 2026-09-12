import { AssumeRoleServiceFactory } from '@aws-access-bridge/backend-services/aws';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

class AssumeRoleRoute extends IActivityAPIRoute<AssumeRoleRequest, AssumeRoleResponse, AssumeRoleEnv> {
  schema = {
    tags: ['AWS'],
    summary: 'Assume AWS IAM Role',
    description:
      "Assumes an AWS IAM role and returns temporary credentials. The user must have permission to assume the specified role, and the role must be configured in the system's credential chain. The returned credentials are temporary and will expire.",
    requestBody: {
      description: 'Role ARN to assume',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn'],
            properties: {
              principalArn: {
                type: 'string' as const,
                minLength: 20,
                maxLength: 2048,
                pattern: String.raw`^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$`,
                description: 'AWS IAM Role ARN in format: arn:aws:iam::123456789012:role/RoleName',
                example: 'arn:aws:iam::123456789012:role/MyRole',
              },
            },
          },
          examples: {
            'standard-role': {
              summary: 'Assume a standard IAM role',
              value: {
                principalArn: 'arn:aws:iam::123456789012:role/DeveloperRole',
              },
            },
            'cross-account-role': {
              summary: 'Assume a cross-account role',
              value: {
                principalArn: 'arn:aws:iam::987654321098:role/CrossAccountAccessRole',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully assumed role and returned temporary credentials',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['accessKeyId', 'secretAccessKey'],
              properties: {
                accessKeyId: {
                  type: 'string' as const,
                  minLength: 16,
                  maxLength: 128,
                  description: 'Temporary AWS Access Key ID (starts with ASIA for temporary credentials)',
                  example: 'ASIAIOSFODNN7EXAMPLE',
                },
                secretAccessKey: {
                  type: 'string' as const,
                  minLength: 16,
                  maxLength: 128,
                  description: 'Temporary AWS Secret Access Key',
                  example: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                },
                sessionToken: {
                  type: 'string' as const,
                  description: 'AWS Session Token for temporary credentials',
                  example: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
                },
                expiration: {
                  type: 'string' as const,
                  format: 'date-time',
                  description: 'ISO 8601 timestamp when credentials expire based on the role session duration',
                  example: '2024-01-15T14:30:00.000Z',
                },
              },
            },
            examples: {
              'temporary-credentials': {
                summary: 'Temporary credentials with expiration',
                value: {
                  accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
                  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                  // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
                  sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
                  expiration: '2024-01-15T14:30:00.000Z',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Invalid request - malformed ARN or missing required fields',
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
      '403': {
        description: 'Forbidden - User does not have permission to assume this role',
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
                      example: 'ForbiddenError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Permission denial details',
                      example: 'User does not have permission to assume role: arn:aws:iam::123456789012:role/RestrictedRole',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '404': {
        description: 'Role not found or not configured in credential chain',
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
                      example: 'NotFoundError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Role or credential chain not found',
                      example: 'Credential chain not found for principal ARN',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error during role assumption',
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
                      example: 'Failed to assume role due to AWS API error',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    // Registered on both surfaces: /user/aws/* (Cloudflare Access JWT)
    // and /api/aws/* (Bearer PAT or HMAC-signed internal calls).
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleRequest(
    request: AssumeRoleRequest,
    env: AssumeRoleEnv,
    cxt: ActivityContext<AssumeRoleEnv>,
  ): Promise<AssumeRoleResponse> {
    if (!request.principalArn) {
      throw new BadRequestError('Missing required fields.');
    }

    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    return AssumeRoleServiceFactory.create(env).assumeRoleForUser(userEmail, request.principalArn);
  }
}

interface AssumeRoleRequest extends IRequest {
  principalArn: string;
}

interface AssumeRoleResponse extends IResponse {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: string;
}

interface AssumeRoleEnv extends IEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeKV: KVNamespace;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { AssumeRoleRoute };
export type { AssumeRoleRequest, AssumeRoleResponse };
