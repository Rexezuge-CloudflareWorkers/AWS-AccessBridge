
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class TestCredentialChainRoute extends IAdminActivityAPIRoute<
  TestCredentialChainRequest,
  TestCredentialChainResponse,
  TestCredentialChainEnv
> {
  schema = {
    tags: ['Admin'],
    summary: 'Test Credential Chain',
    description:
      'Walks the full credential chain for a principal ARN and tests each STS AssumeRole hop. Returns the status of each step in the chain.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'The target principal ARN to test the chain for',
                example: 'arn:aws:iam::123456789012:role/DeveloperRole',
              },
            },
          },
          examples: {
            'test-chain': {
              summary: 'Test credential chain for a role',
              value: { principalArn: 'arn:aws:iam::123456789012:role/DeveloperRole' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Chain test results',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const },
                chain: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      arn: { type: 'string' as const },
                      status: { type: 'string' as const },
                    },
                  },
                },
              },
            },
            examples: {
              'successful-chain': {
                summary: 'All chain hops succeeded',
                value: {
                  success: true,
                  chain: [
                    { arn: 'arn:aws:iam::123456789012:user/deploy-bot', status: 'ok (base credentials)' },
                    { arn: 'arn:aws:iam::123456789012:role/IntermediateRole', status: 'ok' },
                    { arn: 'arn:aws:iam::987654321098:role/DeveloperRole', status: 'ok' },
                  ],
                },
              },
              'failed-chain': {
                summary: 'Chain failed at an intermediate hop',
                value: {
                  success: false,
                  chain: [
                    { arn: 'arn:aws:iam::123456789012:user/deploy-bot', status: 'ok (base credentials)' },
                    { arn: 'arn:aws:iam::123456789012:role/IntermediateRole', status: 'failed: Access denied' },
                  ],
                },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required field'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error during chain test'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(
    request: TestCredentialChainRequest,
    env: TestCredentialChainEnv,
    _cxt: ActivityContext<TestCredentialChainEnv>,
  ): Promise<TestCredentialChainResponse> {
    const { success, chain } = await getRequestScope(_cxt).get(Tokens.CredentialChainService).testChain(request.principalArn);
    return { success, chain };
  }
}

interface TestCredentialChainRequest extends IRequest {
  principalArn: string;
}

interface TestCredentialChainResponse extends IResponse {
  success: boolean;
  chain: Array<{ arn: string; status: string }>;
}

interface TestCredentialChainEnv extends IAdminEnv {
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeDB: D1DatabaseSession;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { TestCredentialChainRoute };
