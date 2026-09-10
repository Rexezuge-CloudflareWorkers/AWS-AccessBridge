import { AwsAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class RemoveAccountNicknameRoute extends IAdminActivityAPIRoute<
  RemoveAccountNicknameRequest,
  RemoveAccountNicknameResponse,
  RemoveAccountNicknameEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Remove AWS Account Nickname',
    description:
      'Removes the nickname from an AWS account, reverting it to display only the account ID. This operation does not delete the account record from the database, only clears the nickname field. If the account does not exist in the database, it will be created automatically without a nickname.',
    requestBody: {
      description: 'Account details for nickname removal',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId'],
            properties: {
              awsAccountId: {
                type: 'string' as const,
                pattern: '^[0-9]{12}$',
                description: 'AWS Account ID (exactly 12 digits)',
                example: '123456789012',
              },
            },
          },
          examples: {
            'remove-nickname': {
              summary: 'Remove nickname from account',
              value: {
                awsAccountId: '123456789012',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully removed the account nickname',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['success', 'message', 'accountId'],
              properties: {
                success: {
                  type: 'boolean' as const,
                  description: 'Indicates if the operation was successful',
                  example: true,
                },
                message: {
                  type: 'string' as const,
                  description: 'Human-readable success message',
                  example: 'Account nickname removed successfully',
                },
                accountId: {
                  type: 'string' as const,
                  description: 'The AWS Account ID that was updated',
                  example: '123456789012',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Invalid request parameters - missing required fields or malformed account ID',
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
        description: 'Internal server error during nickname removal',
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
                      example: 'Failed to remove account nickname from database',
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
    request: RemoveAccountNicknameRequest,
    env: RemoveAccountNicknameEnv,
    _cxt: ActivityContext<RemoveAccountNicknameEnv>,
  ): Promise<RemoveAccountNicknameResponse> {
    if (!request.awsAccountId) {
      throw new BadRequestError('Missing required fields.');
    }

    if (!/^[0-9]{12}$/.test(request.awsAccountId)) {
      throw new BadRequestError('Invalid AWS Account ID format. Must be exactly 12 digits.');
    }

    const accountsDAO = new AwsAccountsDAO(env.AccessBridgeDB);

    await accountsDAO.ensureAccountExists(request.awsAccountId);
    await accountsDAO.removeAccountNickname(request.awsAccountId);

    return {
      success: true,
      message: 'Account nickname removed successfully',
      accountId: request.awsAccountId,
    };
  }
}

interface RemoveAccountNicknameRequest extends IRequest {
  awsAccountId: string;
}

interface RemoveAccountNicknameResponse extends IResponse {
  success: boolean;
  message: string;
  accountId: string;
}

type RemoveAccountNicknameEnv = IAdminEnv;

export { RemoveAccountNicknameRoute };
export type { RemoveAccountNicknameRequest, RemoveAccountNicknameResponse };
