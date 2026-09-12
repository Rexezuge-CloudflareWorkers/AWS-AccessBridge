import {
  AssumableRolesDAO,
  CredentialsCacheDAO,
  UserMetadataDAO,
  EnhancedCredentialsDAO,
  RoleConfigsDAO,
} from '@aws-access-bridge/backend-data/dao';
import { AccessKeysWithExpiration, CredentialCache, CredentialChain, RoleConfig } from '@aws-access-bridge/shared/model';
import { ArnUtil, AssumeRoleUtil } from '@aws-access-bridge/backend-services/aws';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT } from '@aws-access-bridge/backend-runtime/config';
import { INTERMEDIATE_ROLE_SESSION_NAME, ROLE_SESSION_NAME_PREFIX } from '@aws-access-bridge/shared/constants';

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
    const accountId: string = ArnUtil.getAccountIdFromArn(request.principalArn);
    const roleName: string = ArnUtil.getRoleNameFromArn(request.principalArn);

    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(env.AccessBridgeDB);
    await assumableRolesDAO.verifyUserHasAccessToRole(userEmail, accountId, roleName);
    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(env.AccessBridgeDB);
    const roleConfig: RoleConfig | undefined = await roleConfigsDAO.getRoleConfig(accountId, roleName);

    const masterKey: string = await env.AES_ENCRYPTION_KEY_SECRET.get();
    const principalTrustChainLimit: number = parseInt(env.PRINCIPAL_TRUST_CHAIN_LIMIT || DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT);
    const credentialsCacheDAO: CredentialsCacheDAO = new CredentialsCacheDAO(env.AccessBridgeKV, masterKey);
    const credentialsDAO: EnhancedCredentialsDAO = new EnhancedCredentialsDAO(
      env.AccessBridgeDB,
      masterKey,
      principalTrustChainLimit,
      credentialsCacheDAO,
    );
    const credentialChain: CredentialChain = await credentialsDAO.getCredentialChainToFirstCachedPrincipal(request.principalArn);

    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(env.AccessBridgeDB);
    const userId: string = await userMetadataDAO.getOrCreateFederationUsername(userEmail);

    const { startIndex, credentials } = await this.findClosestCachedCredential(credentialsCacheDAO, credentialChain);

    return await this.assumeRoleChain(
      credentialsCacheDAO,
      credentialChain,
      startIndex,
      credentials,
      userId,
      roleConfig?.roleSessionDurationSeconds,
    );
  }

  /**
   * Finds the closest cached credential to the target role in the credential chain.
   * Searches from index 1 (first intermediate role) towards the base IAM user to find
   * the most recent cached intermediate credential that can be reused.
   *
   * @param credentialsCacheDAO - DAO for accessing cached credentials
   * @param credentialChain - The complete credential chain from target role (index 0) to base IAM user (highest index)
   * @returns Object containing the starting index for role assumption and the credentials to start with.
   *          If no cached credential is found, returns base IAM user credentials and starts from index 1.
   *          If cached credential is found at index i, returns cached credentials and starts from index i-1.
   */
  private async findClosestCachedCredential(
    credentialsCacheDAO: CredentialsCacheDAO,
    credentialChain: CredentialChain,
  ): Promise<{ startIndex: number; credentials: AccessKeysWithExpiration }> {
    let startIndex: number = credentialChain.principalArns.length - 2;
    let credentials: AccessKeysWithExpiration = {
      accessKeyId: credentialChain.accessKeyId,
      secretAccessKey: credentialChain.secretAccessKey,
    };
    // Check cache from first intermediate role towards base IAM user to find closest cached credential
    for (let i: number = 1; i < credentialChain.principalArns.length; ++i) {
      const cachedCredential: CredentialCache | undefined = await credentialsCacheDAO.getCachedCredential(credentialChain.principalArns[i]);
      if (cachedCredential) {
        startIndex = i - 1; // Start assuming from the role before the cached one (closer to target)
        credentials = {
          accessKeyId: cachedCredential.accessKeyId,
          secretAccessKey: cachedCredential.secretAccessKey,
          sessionToken: cachedCredential.sessionToken,
        };
        break;
      }
    }
    return { startIndex, credentials };
  }

  /**
   * Assumes roles in the credential chain starting from the given index and working towards the target role.
   * Iterates from startIndex down to 0 (target role), caching intermediate role credentials for future use.
   * Only caches intermediate roles (i > 0), excluding both the target role and base IAM user credentials.
   *
   * @param credentialsCacheDAO - DAO for storing cached credentials
   * @param credentialChain - The complete credential chain from target role (index 0) to base IAM user (highest index)
   * @param startIndex - Index to start role assumption from (decrements towards target at index 0)
   * @param credentials - Starting credentials (either base IAM user or cached intermediate role)
   * @param userId - User ID for role session naming
   * @param roleSessionDurationSeconds - Optional duration for the final target role session
   * @returns Final credentials for the target role (index 0)
   */
  private async assumeRoleChain(
    credentialsCacheDAO: CredentialsCacheDAO,
    credentialChain: CredentialChain,
    startIndex: number,
    credentials: AccessKeysWithExpiration,
    userId: string,
    roleSessionDurationSeconds?: number,
  ): Promise<AccessKeysWithExpiration> {
    let newCredentials: AccessKeysWithExpiration = credentials;
    for (let i = startIndex; i >= 0; --i) {
      const roleArn: string = credentialChain.principalArns[i];
      const sessionName: string = i > 0 ? INTERMEDIATE_ROLE_SESSION_NAME : `${ROLE_SESSION_NAME_PREFIX}${userId}`;
      const durationSeconds: number | undefined = i === 0 ? roleSessionDurationSeconds : undefined;
      newCredentials = await AssumeRoleUtil.assumeRole(roleArn, newCredentials, sessionName, durationSeconds);
      // Cache intermediate credentials (not target role, not base IAM user)
      if (i > 0 && newCredentials.expiration) {
        await credentialsCacheDAO.storeCachedCredential({
          principalArn: roleArn,
          accessKeyId: newCredentials.accessKeyId,
          secretAccessKey: newCredentials.secretAccessKey,
          sessionToken: newCredentials.sessionToken!,
          expiresAt: TimestampUtil.convertIsoToUnixTimestampInSeconds(newCredentials.expiration),
        });
      }
    }
    return newCredentials;
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
