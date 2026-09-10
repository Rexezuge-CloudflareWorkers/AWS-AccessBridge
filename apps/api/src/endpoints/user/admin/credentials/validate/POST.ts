import { AwsClient } from 'aws4fetch';
import { BadRequestError, InternalServerError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class ValidateCredentialsRoute extends IAdminActivityAPIRoute<
  ValidateCredentialsRequest,
  ValidateCredentialsResponse,
  ValidateCredentialsEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Validate AWS Credentials',
    description:
      'Validates AWS credentials by calling STS GetCallerIdentity. Does not store the credentials — only verifies they work and returns the identity information.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['accessKeyId', 'secretAccessKey'],
            properties: {
              accessKeyId: { type: 'string' as const, description: 'AWS Access Key ID' },
              secretAccessKey: { type: 'string' as const, description: 'AWS Secret Access Key' },
              sessionToken: { type: 'string' as const, description: 'AWS Session Token (optional, required for temporary credentials)' },
            },
          },
          examples: {
            'iam-user': {
              summary: 'Validate IAM user credentials',
              value: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              },
            },
            'temporary-credentials': {
              summary: 'Validate temporary credentials with session token',
              value: {
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
        description: 'Credentials are valid - returns STS identity information',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                valid: { type: 'boolean' as const, description: 'Whether the credentials are valid' },
                arn: { type: 'string' as const, description: 'ARN of the IAM entity the credentials belong to' },
                accountId: { type: 'string' as const, description: 'AWS Account ID the credentials belong to' },
                userId: { type: 'string' as const, description: 'Unique identifier of the IAM entity' },
              },
            },
            examples: {
              'valid-iam-user': {
                summary: 'Valid IAM user credentials',
                value: {
                  valid: true,
                  arn: 'arn:aws:iam::123456789012:user/deploy-bot',
                  accountId: '123456789012',
                  userId: 'AIDAIOSFODNN7EXAMPLE',
                },
              },
              'valid-assumed-role': {
                summary: 'Valid assumed role credentials',
                value: {
                  valid: true,
                  arn: 'arn:aws:sts::123456789012:assumed-role/AdminRole/session-name',
                  accountId: '123456789012',
                  userId: 'AROAIOSFODNN7EXAMPLE:session-name',
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request - Missing fields or invalid AWS credentials',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'AWS credentials are invalid: 403 Forbidden' },
                  },
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'No Cloudflare Access JWT token provided in request headers.' },
                  },
                },
              },
            },
          },
        },
      },
      '403': {
        description: 'Forbidden - User is not a superadmin',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'User is not a super admin.' },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error - Failed to parse STS response',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to parse STS GetCallerIdentity response.' },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    request: ValidateCredentialsRequest,
    _env: ValidateCredentialsEnv,
    _cxt: ActivityContext<ValidateCredentialsEnv>,
  ): Promise<ValidateCredentialsResponse> {
    if (!request.accessKeyId || !request.secretAccessKey) {
      throw new BadRequestError('Missing required fields: accessKeyId and secretAccessKey.');
    }

    const stsClient: AwsClient = new AwsClient({
      service: 'sts',
      region: 'us-east-1',
      accessKeyId: request.accessKeyId,
      secretAccessKey: request.secretAccessKey,
      sessionToken: request.sessionToken,
    });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
    });

    const url: string = `https://sts.us-east-1.amazonaws.com/?${queryParams.toString()}`;

    try {
      const response: Response = await stsClient.fetch(url, { method: 'POST' });
      const xmlText: string = await response.text();

      if (!response.ok) {
        throw new BadRequestError(`AWS credentials are invalid: ${response.status} ${response.statusText}`);
      }

      const arnMatch: RegExpMatchArray | null = xmlText.match(/<Arn>([^<]+)<\/Arn>/);
      const accountMatch: RegExpMatchArray | null = xmlText.match(/<Account>([^<]+)<\/Account>/);
      const userIdMatch: RegExpMatchArray | null = xmlText.match(/<UserId>([^<]+)<\/UserId>/);

      if (!arnMatch || !accountMatch || !userIdMatch) {
        throw new InternalServerError('Failed to parse STS GetCallerIdentity response.');
      }

      return {
        valid: true,
        arn: arnMatch[1],
        accountId: accountMatch[1],
        userId: userIdMatch[1],
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestError || error instanceof InternalServerError) {
        throw error;
      }
      throw new BadRequestError(`Failed to validate credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

interface ValidateCredentialsRequest extends IRequest {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

interface ValidateCredentialsResponse extends IResponse {
  valid: boolean;
  arn: string;
  accountId: string;
  userId: string;
}

type ValidateCredentialsEnv = IAdminEnv;

export { ValidateCredentialsRoute };
