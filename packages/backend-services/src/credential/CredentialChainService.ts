import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CredentialsCacheDAO, CredentialsDAO } from '@aws-access-bridge/backend-data/dao';

import type { AccessKeys, Credential, CredentialCache, CredentialChain } from '@aws-access-bridge/shared/model';
import { BadRequestError, ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { CHAIN_TEST_ROLE_SESSION_NAME } from '@aws-access-bridge/shared/constants';
import { StsService } from '../aws/sts';
import { ChainTestWalker, LeafCredentialsWalker } from './CredentialChainWalker';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { resolveCredentialKeys } from '../composition/encryptionKeys';
import type { CredentialKeyProvider } from '../composition/encryptionKeys';

import { log } from '@aws-access-bridge/shared/utils';
type CredentialChainServiceEnv = ServiceEnv;

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
    /**
     * The ordered encryption-key chains for both surfaces. Injected by the
     * composition root from the *same* scope that constructed this service, so the
     * keys are memoized once per request. A service must not look up a scope
     * itself: it only holds `env`, which is not the request's identity, so it
     * would build a second scope and defeat the memo.
     */
    private readonly encryptionKeys: CredentialKeyProvider = defaultKeyProvider(env),
  ) {
    this.sts = sts ?? new StsService();
  }

  public getTrustChainLimit(): number {
    return ConfigurationManager.credential.getTrustChainLimit(this.env);
  }

  /**
  The ordered keys for each encrypted surface: own key first, legacy master key after.
  */
  private async resolveKeys(): Promise<{ credentials: readonly string[]; cache: readonly string[] }> {
    return this.encryptionKeys();
  }

  public async createCredentialsDAO(): Promise<CredentialsDAO> {
    const { credentials } = await this.resolveKeys();
    return new CredentialsDAO(this.env.AccessBridgeDB, credentials, this.getTrustChainLimit());
  }

  public async createCacheDAO(): Promise<CredentialsCacheDAO> {
    if (!this.env.AccessBridgeKV) {
      throw new InternalServerError('Credential cache is not configured for this environment.');
    }
    const { cache } = await this.resolveKeys();
    return new CredentialsCacheDAO(this.env.AccessBridgeKV, cache);
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
    let hops: number = 0;
    let assumedBy: string = principalArn;
    let credential: Credential;
    do {
      trustChain.push(assumedBy);
      hops += 1;
      // The cache is not consulted at the boundary. A hit there is the one case
      // where the short-circuit can serve a chain the cold walk refuses: the cached
      // hop is the last one the budget reaches, so whether the chain continues past
      // it is precisely what is unknown — and returning here answers "it is fine"
      // without ever asking. Every position below the boundary is already accounted
      // for by hops this walk took, so those still short-circuit, and still cost no
      // extra D1 read. That is the whole point of the cache, so it is not traded
      // away to make the boundary decidable; the boundary is decided by the read
      // below, which only the rejected case pays for.
      const atBoundary: boolean = hops >= limit;
      if (assumedBy !== principalArn && !atBoundary) {
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
      // Mirrors `CredentialsDAO.getCredentialChainByPrincipalArn`, and the two must
      // agree: that walk is what the cron and the collection tasks use, so if it
      // refuses a chain this one serves it, the answer depends on cache warmth.
      // `atBoundary` leads only because it is a plain boolean computed above; the
      // two operands have no side effects either way.
      if (atBoundary && credential.assumedBy && credential.assumedBy.length > 0) {
        log.error('Principal chain exceeds the maximum allowed depth', { principalArn: principalArn, limit: limit, hops: hops });
        throw new InternalServerError('Principal chain exceeds the maximum allowed depth. Contact system administrator.');
      }
      if (credential.assumedBy) {
        assumedBy = credential.assumedBy;
      }
    // No depth term here either; see the throw above. Bounding the walk by a counter
    // in the condition is what let the increment and the boundary check disagree.
    } while (credential.assumedBy && credential.assumedBy.length > 0);
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
    sessionName = CHAIN_TEST_ROLE_SESSION_NAME,
  ): Promise<{ success: boolean; chain: Array<{ arn: string; status: string }> }> {
    if (!principalArn) {
      throw new BadRequestError('Missing required field: principalArn.');
    }
    const credentialChain: CredentialChain = await this.getCredentialChain(principalArn);
    return new ChainTestWalker(this.sts).walk(credentialChain, sessionName);
  }
}

/**
 * Reads the two key chains straight from `env`, for a service constructed outside
 * a request scope (tests, ops scripts). The composition root injects the memoized
 * provider instead on the request path.
 */
function defaultKeyProvider(env: CredentialChainServiceEnv): CredentialKeyProvider {
  return async () => resolveCredentialKeys(env);
}

export { CredentialChainService };
export type { CredentialChainServiceEnv };
