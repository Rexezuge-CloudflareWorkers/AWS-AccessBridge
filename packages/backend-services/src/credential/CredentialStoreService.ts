import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CredentialCacheConfigDAO, CredentialsDAO } from '@aws-access-bridge/backend-data/dao';

import { BadRequestError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { AWS_IAM_PRINCIPAL_ARN_PATTERN } from '@aws-access-bridge/shared/schema';
import { StsService, type CallerIdentity } from '../aws/sts';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { resolveCredentialKeys } from '../composition/encryptionKeys';

/**
 * The canonical principal-ARN matcher, not a local copy. The non-capturing group
 * in the previous local definition was cosmetically different from
 * `shared/schema`'s capturing one, which is exactly how two definitions of one
 * validation drift.
 */
const PRINCIPAL_ARN_PATTERN: RegExp = AWS_IAM_PRINCIPAL_ARN_PATTERN;

type CredentialStoreServiceEnv = ServiceEnv;

async function defaultCredentialKeyProvider(env: CredentialStoreServiceEnv): Promise<readonly string[]> {
  const keys = await resolveCredentialKeys(env);
  return keys.credentials;
}

/**
 * Store/relationship CRUD + STS validation slice of the previous
 * `CredentialService` god-class. Pure persistence; no chain walking.
 */
class CredentialStoreService {
  private readonly sts: StsService;

  constructor(
    private readonly env: CredentialStoreServiceEnv,
    sts?: StsService,
    /**
     * The ordered key chain for the `credentials` table, injected by the
     * composition root from the same scope that constructed this service. See
     * `CredentialChainService`'s equivalent for why it is injected.
     */
    private readonly credentialKeys: () => Promise<readonly string[]> = (): Promise<readonly string[]> => defaultCredentialKeyProvider(env),
  ) {
    this.sts = sts ?? new StsService();
  }

  /**
  The ordered keys for the `credentials` table: own key first, legacy master key after.
  */
  public async getEncryptionKeys(): Promise<readonly string[]> {
    return this.credentialKeys();
  }

  public async createCredentialsDAO(): Promise<CredentialsDAO> {
    const limit = ConfigurationManager.credential.getTrustChainLimit(this.env);
    return new CredentialsDAO(this.env.AccessBridgeDB, await this.getEncryptionKeys(), limit);
  }

  public async storeCredential(principalArn: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<void> {
    if (!principalArn || !accessKeyId || !secretAccessKey) {
      throw new BadRequestError('Missing required fields.');
    }
    const dao: CredentialsDAO = await this.createCredentialsDAO();
    await dao.storeCredential(principalArn, accessKeyId, secretAccessKey, sessionToken);
    // Deliberately NOT registered for pre-warm. A principal holding keys is the
    // *base* of a chain: its own chain has length one and `getCredentialChain`
    // refuses it, so the cron could only ever fail on it. The roles worth keeping
    // warm are the ones that sit above a base — see `storeCredentialRelationship`.
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
    // Track the role so the scheduled refresh has work to do. Registered here, where
    // `assumed_by` is set, because only a principal that assumes another has a chain
    // with a hop to pre-assume; without any registration phase 1 of the cron
    // iterates nothing while reporting success.
    await new CredentialCacheConfigDAO(this.env.AccessBridgeDB).create(principalArn);
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
    // Drop the refresh registration too. The table declares
    // `ON DELETE CASCADE`, but D1 does not enforce foreign keys by default, so
    // without this a deleted credential leaves a row the refresh task keeps
    // retrying and failing on.
    await new CredentialCacheConfigDAO(this.env.AccessBridgeDB).delete(principalArn);
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
}

export { CredentialStoreService };
export type { CredentialStoreServiceEnv };
