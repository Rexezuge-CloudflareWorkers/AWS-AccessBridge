import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CredentialsCacheDAO, CredentialsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AccessKeys, Credential, CredentialCache, CredentialChain } from '@aws-access-bridge/shared/model';
import { ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { StsService } from '../aws/sts';
import { ChainTestWalker, LeafCredentialsWalker } from './CredentialChainWalker';

interface CredentialChainServiceEnv {
  AccessBridgeDB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeKV?: KVNamespace;
}

/**
 * Chain-resolution slice of the previous 219-line `CredentialService` god-class.
 * Owns trust-chain walks, KV cache short-circuit, and leaf resolution.
 * Previously `CredentialService`; split per Otter `ApplicationService` facade precedent.
 */
class CredentialChainService {
  private readonly sts: StsService;

  constructor(
    private readonly env: CredentialChainServiceEnv,
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
    const trustChain: string[] = [];
    let depth = 0;
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
    return new LeafCredentialsWalker(this.sts).walk(chain, sessionName);
  }

  public async testChain(
    principalArn: string,
    sessionName = 'AccessBridge-ChainTest',
  ): Promise<{ success: boolean; chain: Array<{ arn: string; status: string }> }> {
    const credentialChain: CredentialChain = await this.getCredentialChain(principalArn);
    return new ChainTestWalker(this.sts).walk(credentialChain, sessionName);
  }
}

export { CredentialChainService };
export type { CredentialChainServiceEnv };
