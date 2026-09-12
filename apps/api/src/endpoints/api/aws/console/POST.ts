import { AwsConsoleUtil } from '@aws-access-bridge/backend-services/aws';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';

class GenerateConsoleUrlRoute extends IActivityAPIRoute<GenerateConsoleUrlRequest, GenerateConsoleUrlResponse, GenerateConsoleUrlEnv> {
  schema = {
    tags: ['AWS'],
    summary: 'Generate AWS Console URL',
    description:
      'Generates a temporary AWS Console login URL using provided AWS credentials. The URL allows direct access to the AWS Management Console without requiring manual authentication. The generated URL expires after 15 minutes for security purposes.',
    requestBody: {
      description: 'AWS credentials required to generate the console URL',
      required: true,
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
                description: 'AWS Access Key ID (typically 20 characters starting with AKIA for permanent keys or ASIA for temporary keys)',
                example: 'AKIAIOSFODNN7EXAMPLE',
              },
              secretAccessKey: {
                type: 'string' as const,
                minLength: 16,
                maxLength: 128,
                description: 'AWS Secret Access Key (typically 40 characters)',
                example: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              },
              sessionToken: {
                type: 'string' as const,
                description: 'AWS Session Token (required for temporary credentials from STS, typically 1000+ characters)',
                example: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
              },
              awsAccountId: {
                type: 'string' as const,
                pattern: String.raw`^\d{12}$`,
                description: 'AWS Account ID (12 digits) - optional, used for federate URL generation',
                example: '123456789012',
              },
              roleName: {
                type: 'string' as const,
                description: 'AWS IAM Role name - optional, used for federate URL generation',
                example: 'DeveloperRole',
              },
              destinationPath: {
                type: 'string' as const,
                description: 'Target AWS Console path to redirect to after authentication',
                example: 'ec2/home',
              },
              destinationRegion: {
                type: 'string' as const,
                description: 'AWS region to set in the destination URL',
                example: 'us-east-1',
              },
            },
          },
          examples: {
            'permanent-credentials': {
              summary: 'Basic permanent credentials',
              description: 'Generate console URL using permanent IAM user credentials',
              value: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              },
            },
            'temporary-credentials': {
              summary: 'Temporary STS credentials',
              description: 'Generate console URL using temporary credentials from AssumeRole',
              value: {
                accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
                sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
              },
            },
            'with-destination-service': {
              summary: 'Direct to specific AWS service',
              description: 'Generate console URL that opens directly to EC2 dashboard',
              value: {
                accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
                sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
                destinationPath: 'ec2/home',
                destinationRegion: 'us-east-1',
              },
            },
            'with-federate-params': {
              summary: 'Role-based federated access',
              description: 'Generate console URL with role context for federated access tracking',
              value: {
                accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
                sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
                awsAccountId: '123456789012',
                roleName: 'DeveloperRole',
              },
            },
            'cross-account-role': {
              summary: 'Cross-account role assumption',
              description: 'Generate console URL for assumed role in different AWS account',
              value: {
                accessKeyId: 'ASIAI2EXAMPLE3EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
                // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
                sessionToken: 'AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLXCrrrUtdnniCEXAMPLE',
                awsAccountId: '987654321098',
                roleName: 'CrossAccountAdminRole',
                destinationPath: 'iam/home',
                destinationRegion: 'us-west-2',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successfully generated AWS Console URL',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['url'],
              properties: {
                url: {
                  type: 'string' as const,
                  format: 'uri',
                  description: 'Pre-authenticated AWS Console URL that expires after 15 minutes',
                  example:
                    'https://signin.aws.amazon.com/federation?Action=login&Issuer=AccessBridge&Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F&SigninToken=VCaXjShAlpsXGHeOP1HnSjxuJMd1c1YvwjKNsKGKigo',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Invalid request parameters or missing required fields',
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
                      example: 'Missing required field: accessKeyId',
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
        description: 'Internal server error during URL generation',
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
                      example: 'Failed to generate AWS signin token',
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
    request: GenerateConsoleUrlRequest,
    _env: GenerateConsoleUrlEnv,
    cxt: ActivityContext<GenerateConsoleUrlEnv>,
  ): Promise<GenerateConsoleUrlResponse> {
    const signinToken: string = await AwsConsoleUtil.getSigninToken(request.accessKeyId, request.secretAccessKey, request.sessionToken);
    let federateUrl: string = this.getBaseUrl(cxt);
    if (request.awsAccountId && request.roleName) {
      federateUrl += `/user/aws/federate?awsAccountId=${request.awsAccountId}&role=${request.roleName}`;
    }
    let destination: string = request.destinationPath
      ? `https://console.aws.amazon.com/${request.destinationPath}`
      : 'https://console.aws.amazon.com/';
    if (request.destinationRegion) {
      const url: URL = new URL(destination);
      url.searchParams.set('region', request.destinationRegion);
      destination = url.href;
    }
    const loginUrl: string = AwsConsoleUtil.getLoginUrl(signinToken, federateUrl, destination);
    return {
      url: loginUrl,
    };
  }
}

interface GenerateConsoleUrlRequestInternal {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  awsAccountId?: string;
  roleName?: string;
  destinationPath?: string;
  destinationRegion?: string;
}

interface GenerateConsoleUrlResponseInternal {
  url: string;
}

interface GenerateConsoleUrlRequest extends IRequest, GenerateConsoleUrlRequestInternal {}

interface GenerateConsoleUrlResponse extends IResponse, GenerateConsoleUrlResponseInternal {}

type GenerateConsoleUrlEnv = IEnv;

export { GenerateConsoleUrlRoute };
export type { GenerateConsoleUrlRequestInternal, GenerateConsoleUrlResponseInternal };
export type { GenerateConsoleUrlRequest, GenerateConsoleUrlResponse };
