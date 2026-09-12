import { CredentialsDAO } from './CredentialsDAO';
import { CredentialsCacheDAO } from './CredentialsCacheDAO';
import { Credential, CredentialCache, CredentialChain } from '@aws-access-bridge/shared/model';
import { ForbiddenError, InternalServerError } from '@aws-access-bridge/backend-errors';

class EnhancedCredentialsDAO extends CredentialsDAO {
  protected readonly credentialsCacheDAO: CredentialsCacheDAO;

  constructor(
    database: D1Database | D1DatabaseSession,
    masterKey: string,
    principalTrustChainLimit: number,
    credentialsCacheDAO: CredentialsCacheDAO,
  ) {
    super(database, masterKey, principalTrustChainLimit);
    this.credentialsCacheDAO = credentialsCacheDAO;
  }

  public async getCredentialChainToFirstCachedPrincipal(principalArn: string): Promise<CredentialChain> {
    const trustChain: Array<string> = [];
    let depth: number = 0;
    let assumedBy: string = principalArn;
    let credential: Credential;
    do {
      trustChain.push(assumedBy);
      if (assumedBy !== principalArn) {
        const cachedCredential: CredentialCache | undefined = await this.credentialsCacheDAO.getCachedCredential(assumedBy);
        if (cachedCredential) {
          return {
            principalArns: trustChain,
            accessKeyId: cachedCredential.accessKeyId,
            secretAccessKey: cachedCredential.secretAccessKey,
            sessionToken: cachedCredential.sessionToken,
          };
        }
      }
      credential = await this.getCredentialByPrincipalArn(assumedBy);
      if (credential.assumedBy) {
        assumedBy = credential.assumedBy;
      }
    } while (credential.assumedBy && credential.assumedBy.length > 0 && ++depth <= this.principalTrustChainLimit);
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
    if (depth >= this.principalTrustChainLimit) {
      console.error('Principal chain exceeds the maximum allowed depth:', this.principalTrustChainLimit);
    }
    throw new InternalServerError('Principal chain is not valid. Contact system administrator.');
  }
}

export { EnhancedCredentialsDAO };
