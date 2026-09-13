import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { BadRequestError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { StsService, type CallerIdentity } from '../aws/sts';

const PRINCIPAL_ARN_PATTERN = /^arn:aws:iam::\d{12}:(?:role|user)\/.+$/;

interface CredentialStoreServiceEnv {
  AccessBridgeDB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
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
  ) {
    this.sts = sts ?? new StsService();
  }

  public async getMasterKey(): Promise<string> {
    if (!this.env.AES_ENCRYPTION_KEY_SECRET) {
      throw new InternalServerError('Credential encryption key is not configured for this environment.');
    }
    return this.env.AES_ENCRYPTION_KEY_SECRET.get();
  }

  public async createCredentialsDAO(): Promise<CredentialsDAO> {
    const limit = ConfigurationManager.credential.getTrustChainLimit(this.env);
    return new CredentialsDAO(this.env.AccessBridgeDB, await this.getMasterKey(), limit);
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
}

export { CredentialStoreService, PRINCIPAL_ARN_PATTERN };
export type { CredentialStoreServiceEnv };
