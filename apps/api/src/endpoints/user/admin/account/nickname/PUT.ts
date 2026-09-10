import { AwsAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class SetAccountNicknameRoute extends IAdminActivityAPIRoute<SetAccountNicknameRequest, SetAccountNicknameResponse, SetAccountNicknameEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Set AWS Account Nickname',
    description:
      'Sets or updates a friendly nickname for an AWS account. The nickname helps users identify accounts more easily in the interface. If the account does not exist in the database, it will be created automatically.',
    requestBody: {
      description: 'Account nickname details',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'nickname'],
            properties: {
              awsAccountId: {
                type: 'string' as const,
                pattern: '^[0-9]{12}$',
                description: 'AWS Account ID (exactly 12 digits)',
                example: '123456789012',
              },
              nickname: {
                type: 'string' as const,
                minLength: 1,
                maxLength: 255,
                description: 'Friendly nickname for the AWS account (1-255 characters)',
                example: 'Production Environment',
              },
            },
          },
          examples: {
            'production-account': {
              summary: 'Set nickname for production account',
              value: {
                awsAccountId: '123456789012',
                nickname: 'Production Environment',
              },
            },
            'development-account': {
              summary: 'Set nickname for development account',
              value: {
                awsAccountId: '987654321098',
                nickname: 'Development & Testing',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully set or updated the account nickname',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['success', 'message', 'accountId', 'nickname'],
              properties: {
                success: {
                  type: 'boolean' as const,
                  description: 'Indicates if the operation was successful',
                  example: true,
                },
                message: {
                  type: 'string' as const,
                  description: 'Human-readable success message',
                  example: 'Account nickname set successfully',
                },
                accountId: {
                  type: 'string' as const,
                  description: 'The AWS Account ID that was updated',
                  example: '123456789012',
                },
                nickname: {
                  type: 'string' as const,
                  description: 'The nickname that was set',
                  example: 'Production Environment',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Invalid request parameters - missing required fields or malformed data',
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
        description: 'Internal server error during nickname update',
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
                      example: 'Failed to update account nickname in database',
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
    request: SetAccountNicknameRequest,
    env: SetAccountNicknameEnv,
    _cxt: ActivityContext<SetAccountNicknameEnv>,
  ): Promise<SetAccountNicknameResponse> {
    if (!request.awsAccountId || !request.nickname) {
      throw new BadRequestError('Missing required fields.');
    }

    if (!/^[0-9]{12}$/.test(request.awsAccountId)) {
      throw new BadRequestError('Invalid AWS Account ID format. Must be exactly 12 digits.');
    }

    if (request.nickname.trim().length === 0) {
      throw new BadRequestError('Nickname cannot be empty.');
    }

    if (request.nickname.length > 255) {
      throw new BadRequestError('Nickname cannot exceed 255 characters.');
    }

    const accountsDAO = new AwsAccountsDAO(env.AccessBridgeDB);

    await accountsDAO.ensureAccountExists(request.awsAccountId);
    await accountsDAO.setAccountNickname(request.awsAccountId, request.nickname.trim());

    return {
      success: true,
      message: 'Account nickname set successfully',
      accountId: request.awsAccountId,
      nickname: request.nickname.trim(),
    };
  }
}

interface SetAccountNicknameRequest extends IRequest {
  awsAccountId: string;
  nickname: string;
}

interface SetAccountNicknameResponse extends IResponse {
  success: boolean;
  message: string;
  accountId: string;
  nickname: string;
}

type SetAccountNicknameEnv = IAdminEnv;

export { SetAccountNicknameRoute };
export type { SetAccountNicknameRequest, SetAccountNicknameResponse };
