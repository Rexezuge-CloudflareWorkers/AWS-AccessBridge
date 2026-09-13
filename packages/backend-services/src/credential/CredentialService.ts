import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { CredentialChain } from '@aws-access-bridge/shared/model';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { StsService, type CallerIdentity } from '../aws/sts';
import { CredentialChainService } from './CredentialChainService';
import { CredentialStoreService } from './CredentialStoreService';

interface CredentialServiceEnv {
  AccessBridgeDB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  AccessBridgeKV?: KVNamespace;
}

/**
 * Facade over `CredentialChainService` (chain resolution) +
 * `CredentialStoreService` (CRUD/validation).
 * Previously a 219-line god-class mixing both; delegates here.
 * Kept for backwards compatibility — new code resolves slices via
 * `scope.get(Tokens.CredentialChainService)` / `Tokens.CredentialStoreService`.
 */
class CredentialService {
  private readonly chain: CredentialChainService;
  private readonly store: CredentialStoreService;

  constructor(
    private readonly env: CredentialServiceEnv,
    sts?: StsService,
  ) {
    this.chain = new CredentialChainService(env, sts);
    this.store = new CredentialStoreService(env, sts);
  }

  public getTrustChainLimit(): number {
    return this.chain.getTrustChainLimit();
  }

  public async getMasterKey(): Promise<string> {
    return this.chain.getMasterKey();
  }

  public async createCredentialsDAO() {
    return this.chain.createCredentialsDAO();
  }

  public async createCacheDAO() {
    return this.chain.createCacheDAO();
  }

  public async getCredentialChain(principalArn: string): Promise<CredentialChain> {
    return this.chain.getCredentialChain(principalArn);
  }

  public async getCredentialChainToFirstCachedPrincipal(principalArn: string): Promise<CredentialChain> {
    return this.chain.getCredentialChainToFirstCachedPrincipal(principalArn);
  }

  public async storeCredential(principalArn: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<void> {
    return this.store.storeCredential(principalArn, accessKeyId, secretAccessKey, sessionToken);
  }

  public async storeCredentialRelationship(principalArn: string, assumedBy: string): Promise<void> {
    return this.store.storeCredentialRelationship(principalArn, assumedBy);
  }

  public async removeCredential(principalArn: string): Promise<void> {
    return this.store.removeCredential(principalArn);
  }

  public async validateCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<CallerIdentity> {
    return this.store.validateCredentials(accessKeyId, secretAccessKey, sessionToken);
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
    return this.chain.resolveLeafCredentials(principalArn, sessionName);
  }

  public async testChain(
    principalArn: string,
    sessionName: string = 'AccessBridge-ChainTest',
  ): Promise<{ success: boolean; chain: Array<{ arn: string; status: string }> }> {
    if (!principalArn) {
      const { BadRequestError } = await import('@aws-access-bridge/backend-errors');
      throw new BadRequestError('Missing required field: principalArn.');
    }
    return this.chain.testChain(principalArn, sessionName);
  }
}

class CredentialServiceFactory {
  public static create(env: CredentialServiceEnv): CredentialService {
    return new CredentialService(env);
  }
}

export { CredentialService, CredentialServiceFactory };
export type { CredentialServiceEnv };
