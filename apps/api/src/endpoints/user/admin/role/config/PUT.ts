import { RoleConfigsDAO, AwsAccountsDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class SetRoleConfigRoute extends IAdminActivityAPIRoute<SetRoleConfigRequest, SetRoleConfigResponse, SetRoleConfigEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Set Role Configuration',
    description:
      'Sets or updates configuration for a specific AWS role, including destination path and region settings. This allows customization of where users are redirected when assuming roles through the AWS Console. If the AWS account does not exist in the database, it will be created automatically. This operation is idempotent - setting the same configuration multiple times will not cause an error.',
    requestBody: {
      description: 'Role configuration details to set or update',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['awsAccountId', 'roleName'],
            properties: {
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
              destinationPath: {
                type: 'string' as const,
                description: 'Optional destination path for AWS Console redirection after role assumption',
                example: '/ec2/home',
                maxLength: 512,
              },
              destinationRegion: {
                type: 'string' as const,
                description: 'Optional AWS region for AWS Console redirection after role assumption',
                example: 'us-east-1',
                maxLength: 32,
              },
              roleSessionDurationSeconds: {
                type: 'integer' as const,
                description:
                  'Optional target role session duration in seconds. AWS supports 900 through 43200 seconds; chained role sessions are capped at 3600 seconds.',
                example: 3600,
                minimum: 900,
                maximum: 43200,
              },
            },
          },
          examples: {
            'ec2-console-config': {
              summary: 'Configure role to redirect to EC2 console',
              description: 'Sets up a developer role to redirect users to the EC2 dashboard in us-west-2',
              value: {
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
                destinationPath: '/ec2/home',
                destinationRegion: 'us-west-2',
                roleSessionDurationSeconds: 14400,
              },
            },
            's3-console-config': {
              summary: 'Configure role to redirect to S3 console',
              description: 'Sets up an admin role to redirect users to the S3 console in eu-west-1',
              value: {
                awsAccountId: '987654321098',
                roleName: 'AdminRole',
                destinationPath: '/s3/buckets',
                destinationRegion: 'eu-west-1',
              },
            },
            'basic-config': {
              summary: 'Basic role configuration without redirection',
              description: 'Sets up a role without specific console redirection settings',
              value: {
                awsAccountId: '555666777888',
                roleName: 'ReadOnlyRole',
              },
            },
            'cloudformation-config': {
              summary: 'Configure role for CloudFormation console',
              description: 'Sets up a DevOps role to redirect to CloudFormation stacks',
              value: {
                awsAccountId: '111222333444',
                roleName: 'DevOpsRole',
                destinationPath: '/cloudformation/stacks',
                destinationRegion: 'us-east-1',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully set or updated the role configuration',
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
                  example: 'Role configuration set successfully',
                },
              },
            },
            examples: {
              'config-set': {
                summary: 'Successful role configuration',
                value: {
                  success: true,
                  message: 'Role configuration set successfully',
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
              'invalid-account-id': {
                summary: 'Invalid AWS Account ID',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'AWS Account ID must be exactly 12 digits.',
                  },
                },
              },
              'empty-role-name': {
                summary: 'Empty role name',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Role name cannot be empty.',
                  },
                },
              },
              'path-too-long': {
                summary: 'Destination path too long',
                value: {
                  Exception: {
                    Type: 'BadRequestError',
                    Message: 'Destination path cannot exceed 512 characters.',
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
        description: 'Internal server error during role configuration operation',
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
                      example: 'Failed to set role configuration in database',
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
    request: SetRoleConfigRequest,
    env: SetRoleConfigEnv,
    _cxt: ActivityContext<SetRoleConfigEnv>,
  ): Promise<SetRoleConfigResponse> {
    if (!request.awsAccountId || !request.roleName) {
      throw new BadRequestError('Missing required fields.');
    }

    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(env.AccessBridgeDB);

    await accountsDAO.ensureAccountExists(request.awsAccountId);
    await roleConfigsDAO.setRoleConfig(
      request.awsAccountId,
      request.roleName,
      request.destinationPath,
      request.destinationRegion,
      request.roleSessionDurationSeconds,
    );

    return {
      success: true,
      message: 'Role configuration set successfully',
    };
  }
}

interface SetRoleConfigRequest extends IRequest {
  awsAccountId: string;
  roleName: string;
  destinationPath?: string;
  destinationRegion?: string;
  roleSessionDurationSeconds?: number;
}

interface SetRoleConfigResponse extends IResponse {
  success: boolean;
  message: string;
}

type SetRoleConfigEnv = IAdminEnv;

export { SetRoleConfigRoute };
export type { SetRoleConfigRequest, SetRoleConfigResponse };
