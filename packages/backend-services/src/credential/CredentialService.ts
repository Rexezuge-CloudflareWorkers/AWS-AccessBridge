import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CredentialsCacheDAO, CredentialsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { Credential, CredentialCache, CredentialChain } from '@aws-access-bridge/shared/model';
import type { AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { BadRequestError, ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { StsService, type CallerIdentity } from '../aws/sts';

const PRINCIPAL_ARN_PATTERN = /^arn:aws:iam::\d{12}:(?:role|user)\/.+$/;

interface CredentialServiceEnv {
  AccessBridgeDB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeKV?: KVNamespace;
}

class CredentialService {
  private readonly sts: StsService;

  constructor(
    private readonly env: CredentialServiceEnv,
    sts?: StsService,
  ) {
    this.sts = sts ?? new StsService();
  }

  public getTrustChainLimit(): number {
    return ConfigurationManager.credential.getTrustChainLimit(this.env);
  }

  public async getMasterKey(): Promise<string> {
    if (!this.env.AES_ENCRYPTION_KEY_SECRET) {
      throw new InternalServerError('Credential encryption key is not configured for this environment.');
    }
    return this.env.AES_ENCRYPTION_KEY_SECRET.get();
  }

  public async createCredentialsDAO(): Promise<CredentialsDAO> {
    return new CredentialsDAO(this.env.AccessBridgeDB, await this.getMasterKey(), this.getTrustChainLimit());
  }

  public async createCacheDAO(): Promise<CredentialsCacheDAO> {
    if (!this.env.AccessBridgeKV) {
      throw new InternalServerError('Credential cache is not configured for this environment.');
    }
    return new CredentialsCacheDAO(this.env.AccessBridgeKV, await this.getMasterKey());
  }

  public async getCredentialChain(principalArn: string): Promise<CredentialChain> {
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    return dao.getCredentialChainByPrincipalArn(principalArn);
  }

  public async getCredentialChainToFirstCachedPrincipal(principalArn: string): Promise<CredentialChain> {
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    const cacheDAO: CredentialsCacheDAO = await this.createCacheDAO();
    const limit: number = this.getTrustChainLimit();
    const trustChain: Array<string> = [];
    let depth: number = 0;
    let assumedBy: string = principalArn;
    let credential: Credential;
    do {
      trustChain.push(assumedBy);
      if (assumedBy !== principalArn) {
        const cachedCredential: CredentialCache | undefined = await cacheDAO.getCachedCredential(assumedBy);
        if (cachedCredential) {
          return {
            principalArns: trustChain,
            accessKeyId: cachedCredential.accessKeyId,
            secretAccessKey: cachedCredential.secretAccessKey,
            sessionToken: cachedCredential.sessionToken,
          };
        }
      }
      credential = await dao.getCredentialByPrincipalArn(assumedBy);
      if (credential.assumedBy) {
        assumedBy = credential.assumedBy;
      }
    } while (credential.assumedBy && credential.assumedBy.length > 0 && ++depth <= limit);
    if (credential.accessKeyId && credential.secretAccessKey) {
      if (trustChain.length > 1) {
        return {
          principalArns: trustChain,
          accessKeyId: credential.accessKeyId,
          secretAccessKey: credential.secretAccessKey,
          sessionToken: credential.sessionToken,
        };
      }
      throw new ForbiddenError('For security reasons, long-term credentials are not retrievable.');
    }
    if (depth >= limit) {
      console.error('Principal chain exceeds the maximum allowed depth:', limit);
    }
    throw new InternalServerError('Principal chain is not valid. Contact system administrator.');
  }

  public async storeCredential(principalArn: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<void> {
    if (!principalArn || !accessKeyId || !secretAccessKey) {
      throw new BadRequestError('Missing required fields.');
    }
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    await dao.storeCredential(principalArn, accessKeyId, secretAccessKey, sessionToken);
  }

  public async storeCredentialRelationship(principalArn: string, assumedBy: string): Promise<void> {
    if (!principalArn || !assumedBy) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!PRINCIPAL_ARN_PATTERN.test(principalArn)) {
      throw new BadRequestError('Invalid principal ARN format.');
    }
    if (!PRINCIPAL_ARN_PATTERN.test(assumedBy)) {
      throw new BadRequestError('Invalid assumedBy ARN format.');
    }
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    await dao.storeCredentialRelationship(principalArn, assumedBy);
  }

  public async removeCredential(principalArn: string): Promise<void> {
    if (!principalArn) {
      throw new BadRequestError('Missing required fields.');
    }
    if (!PRINCIPAL_ARN_PATTERN.test(principalArn)) {
      throw new BadRequestError('Invalid principal ARN format.');
    }
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    await dao.removeCredential(principalArn);
  }

  public async validateCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<CallerIdentity> {
    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestError('Missing required fields: accessKeyId and secretAccessKey.');
    }
    try {
      return await this.sts.validateCredentials(accessKeyId, secretAccessKey, sessionToken);
    } catch (error: unknown) {
      if (error instanceof BadRequestError || error instanceof InternalServerError) {
        throw error;
      }
      throw new BadRequestError(`Failed to validate credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolves the full credential chain for a principal and walks it from the
   * base credentials down to the leaf (target) role, returning credentials
   * usable for direct AWS API calls. Shared by collection cron tasks.
   */
  public async resolveLeafCredentials(
    principalArn: string,
    sessionName: string,
  ): Promise<{ chain: CredentialChain; credentials: AccessKeys }> {
    const chain: CredentialChain = await this.getCredentialChain(principalArn);
    let credentials: AccessKeys = {
      accessKeyId: chain.accessKeyId,
      secretAccessKey: chain.secretAccessKey,
      sessionToken: chain.sessionToken,
    };
    for (let i = chain.principalArns.length - 2; i >= 0; i--) {
      credentials = await this.sts.assumeRole(chain.principalArns[i], credentials, sessionName);
    }
    return { chain, credentials };
  }

  public async testChain(
    principalArn: string,
    sessionName: string = 'AccessBridge-ChainTest',
  ): Promise<{ success: boolean; chain: Array<{ arn: string; status: string }> }> {
    if (!principalArn) {
      throw new BadRequestError('Missing required field: principalArn.');
    }
    const credentialChain: CredentialChain = await this.getCredentialChain(principalArn);

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
      // eslint-disable-next-line unicorn/prefer-at -- index access preserves `string` type; `.at()` widens to `string | undefined`
      arn: credentialChain.principalArns[credentialChain.principalArns.length - 1],
      status: 'ok (base credentials)',
    });

    for (let i = credentialChain.principalArns.length - 2; i >= 0; i--) {
      const roleArn: string = credentialChain.principalArns[i];
      try {
        const assumed: AccessKeysWithExpiration = await this.sts.assumeRole(roleArn, credential, sessionName);
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

class CredentialServiceFactory {
  public static create(env: CredentialServiceEnv): CredentialService {
    return new CredentialService(env);
  }
}

export { CredentialService, CredentialServiceFactory };
export type { CredentialServiceEnv };
