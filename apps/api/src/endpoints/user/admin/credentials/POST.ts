import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
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
                // eslint-disable-next-line sonarjs/no-hardcoded-secrets -- AWS-documented EXAMPLE placeholder, not a real secret
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
      '400': badRequestResponse('Invalid request - missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing authentication or invalid user'),
      '500': internalServerErrorResponse('Internal server error during credential storage'),
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
    await getRequestScope(_cxt)
      .get(Tokens.CredentialStoreService)
      .storeCredential(request.principalArn, request.accessKeyId, request.secretAccessKey, request.sessionToken);

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
  sessionToken?: string;
}

interface StoreCredentialResponse extends IResponse {
  success: boolean;
  message: string;
}

interface StoreCredentialEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { StoreCredentialRoute };
