import { CredentialsDAO } from '@/dao';
import { AssumeRoleUtil } from '@/utils';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { ActivityContext, IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import type { CredentialChain, AccessKeys, AccessKeysWithExpiration } from '@/model';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@/constants';

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
      '400': {
        description: 'Bad request - Missing required field',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required field: principalArn.' },
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
        description: 'Internal server error during chain test',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to test credential chain.' },
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
    request: TestCredentialChainRequest,
    env: TestCredentialChainEnv,
    _cxt: ActivityContext<TestCredentialChainEnv>,
  ): Promise<TestCredentialChainResponse> {
    if (!request.principalArn) {
      throw new BadRequestError('Missing required field: principalArn.');
    }

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsDAO: CredentialsDAO = new CredentialsDAO(env.AccessBridgeDB, masterKey, principalTrustChainLimit);

    const credentialChain: CredentialChain = await credentialsDAO.getCredentialChainByPrincipalArn(request.principalArn);

    const chainResults: Array<{ arn: string; status: string }> = [];
    let allSuccess: boolean = true;

    let credential: AccessKeys = {
      accessKeyId: credentialChain.accessKeyId,
      secretAccessKey: credentialChain.secretAccessKey,
      sessionToken: credentialChain.sessionToken,
    };

    // The chain is ordered: [target, intermediate, ..., base]
    // We walk from base (last) to target (first), assuming each role
    chainResults.push({
      arn: credentialChain.principalArns[credentialChain.principalArns.length - 1],
      status: 'ok (base credentials)',
    });

    for (let i = credentialChain.principalArns.length - 2; i >= 0; i--) {
      const roleArn: string = credentialChain.principalArns[i];
      try {
        const assumed: AccessKeysWithExpiration = await AssumeRoleUtil.assumeRole(roleArn, credential, 'AccessBridge-ChainTest');
        credential = assumed;
        chainResults.push({ arn: roleArn, status: 'ok' });
      } catch (error: unknown) {
        allSuccess = false;
        chainResults.push({
          arn: roleArn,
          status: `failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        break;
      }
    }

    return { success: allSuccess, chain: chainResults };
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
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string | undefined;
  AccessBridgeDB: D1DatabaseSession;
  AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
}

export { TestCredentialChainRoute };
