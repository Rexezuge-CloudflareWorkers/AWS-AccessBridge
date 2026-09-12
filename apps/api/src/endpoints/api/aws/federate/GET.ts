import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse, ExtendedResponse } from '@/endpoints/IActivityAPIRoute';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import type { AssumeRoleResponse } from '@/endpoints/api/aws/assume-role/POST';
import type { GenerateConsoleUrlRequestInternal, GenerateConsoleUrlResponse } from '@/endpoints/api/aws/console/POST';
import { InternalRequestHelper } from '@aws-access-bridge/backend-services/aws';
import { ErrorDeserializationUtil } from '@aws-access-bridge/backend-services/error';
import { AccountServiceFactory } from '@aws-access-bridge/backend-services/account';
import type { RoleConfig } from '@aws-access-bridge/shared/model';

class FederateRoute extends IActivityAPIRoute<FederateRequest, FederateResponse, FederateEnv> {
  schema = {
    tags: ['AWS'],
    summary: 'Federate AWS Access',
    description:
      'Assumes an AWS role and generates a console URL in a single request. This endpoint combines role assumption and console URL generation into one operation, returning a redirect to the AWS Console.',
    parameters: [
      {
        name: 'awsAccountId',
        in: 'query' as const,
        required: true,
        schema: {
          type: 'string' as const,
          pattern: String.raw`^\d{12}$`,
          description: 'AWS Account ID (12 digits)',
          example: '123456789012',
        },
      },
      {
        name: 'role',
        in: 'query' as const,
        required: true,
        schema: {
          type: 'string' as const,
          description: 'AWS IAM Role name',
          example: 'DeveloperRole',
        },
      },
      {
        name: 'destinationPath',
        in: 'query' as const,
        required: false,
        schema: {
          type: 'string' as const,
          description: 'Optional AWS Console path to redirect to after role assumption',
          example: 'ec2/home#InstanceDetails:instanceId=i-0abc123def456789',
        },
      },
      {
        name: 'destinationRegion',
        in: 'query' as const,
        required: false,
        schema: {
          type: 'string' as const,
          description: 'Optional AWS region to set in the destination URL',
          example: 'us-east-1',
        },
      },
    ],
    responses: {
      '302': {
        description: 'Redirect to AWS Console URL',
        headers: {
          Location: {
            description: 'Pre-authenticated AWS Console URL that expires after 15 minutes',
            schema: {
              type: 'string' as const,
              format: 'uri',
              example:
                'https://signin.aws.amazon.com/federation?Action=login&Issuer=AccessBridge&Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F&SigninToken=VCaXjShAlpsXGHeOP1HnSjxuJMd1c1YvwjKNsKGKigo',
            },
          },
        },
      },
      '400': {
        description: 'Missing required query parameters',
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
                      description: 'Details about the missing or invalid parameters',
                      example: 'Missing required query parameters.',
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
      '403': {
        description: 'Forbidden - User not authorized to assume the specified role',
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
                      description: 'Authorization error details',
                      example: 'User not authorized to assume role: arn:aws:iam::123456789012:role/DeveloperRole',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error during role assumption or URL generation',
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
                      example: 'Failed to assume AWS role',
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
    request: FederateRequest,
    env: FederateEnv,
    cxt: ActivityContext<FederateEnv>,
  ): Promise<ExtendedResponse<FederateResponse>> {
    const url: URL = new URL(request.raw.url);
    const awsAccountId: string | null = url.searchParams.get('awsAccountId');
    const roleName: string | null = url.searchParams.get('role');
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required query parameters.');
    }
    const destinationPath: string | null = url.searchParams.get('destinationPath');
    const destinationRegion: string | null = url.searchParams.get('destinationRegion');
    const principalArn: string = `arn:aws:iam::${awsAccountId}:role/${roleName}`;
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const baseUrl: string = this.getBaseUrl(cxt);
    const roleConfig: RoleConfig | undefined = await AccountServiceFactory.create(env).getRoleConfig(awsAccountId, roleName);
    const hmacSecret: string = await env.INTERNAL_HMAC_SECRET.get();
    const internalRequestHelper: InternalRequestHelper = new InternalRequestHelper(env.SELF, hmacSecret);
    const assumeRoleResponse: Response = await internalRequestHelper.makeRequest(
      '/api/aws/assume-role',
      'POST',
      JSON.stringify({ principalArn }),
      baseUrl,
      userEmail,
    );
    if (!assumeRoleResponse.ok) {
      throw await ErrorDeserializationUtil.deserializeError(assumeRoleResponse);
    }
    const credentials: AssumeRoleResponse = await assumeRoleResponse.json();
    const consoleUrlRequest: GenerateConsoleUrlRequestInternal = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      awsAccountId: awsAccountId,
      roleName: roleName,
      destinationPath: destinationPath || roleConfig?.destinationPath,
      destinationRegion: destinationRegion || roleConfig?.destinationRegion,
    };
    const consoleResponse: Response = await internalRequestHelper.makeRequest(
      '/api/aws/console',
      'POST',
      JSON.stringify(consoleUrlRequest),
      baseUrl,
      userEmail,
    );
    if (!consoleResponse.ok) {
      throw await ErrorDeserializationUtil.deserializeError(consoleResponse);
    }
    const consoleData: GenerateConsoleUrlResponse = await consoleResponse.json();
    return {
      statusCode: 302,
      headers: {
        Location: consoleData.url,
      },
    };
  }
}

type FederateRequest = IRequest;

type FederateResponse = IResponse;

interface FederateEnv extends IEnv {
  SELF: Fetcher;
  INTERNAL_HMAC_SECRET: SecretsStoreSecret;
}

export { FederateRoute };
export type { FederateRequest, FederateResponse };
