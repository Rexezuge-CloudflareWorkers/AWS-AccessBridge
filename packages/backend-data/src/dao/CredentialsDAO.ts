import { DatabaseError, ForbiddenError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { Credential, CredentialChain, CredentialInternal } from '@aws-access-bridge/shared/model';
import { decryptDataOptional, encryptData } from '@aws-access-bridge/backend-data/crypto/aes-gcm';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { EncryptedDAO } from './BaseDAO';

class CredentialsDAO extends EncryptedDAO {
  protected readonly principalTrustChainLimit: number;

  constructor(database: D1Queryable, masterKey: string, principalTrustChainLimit: number) {
    super(database, masterKey);
    this.principalTrustChainLimit = principalTrustChainLimit;
  }

  public async getCredentialByPrincipalArn(principalArn: string): Promise<Credential> {
    const result: CredentialInternal | null = await this.database
      .prepare(
        `SELECT principal_arn, assumed_by, encrypted_access_key_id, encrypted_secret_access_key, encrypted_session_token, salt
         FROM credentials
         WHERE principal_arn = ?
         LIMIT 1`,
      )
      .bind(principalArn)
      .first<CredentialInternal>();

    if (!result) {
      throw new UnauthorizedError();
    }

    return {
      principalArn: result.principal_arn,
      assumedBy: result.assumed_by,
      accessKeyId: await decryptDataOptional(result.encrypted_access_key_id, result.salt, this.masterKey),
      secretAccessKey: await decryptDataOptional(result.encrypted_secret_access_key, result.salt, this.masterKey),
      sessionToken: await decryptDataOptional(result.encrypted_session_token, result.salt, this.masterKey),
    };
  }

  public async getCredentialChainByPrincipalArn(principalArn: string): Promise<CredentialChain> {
    const trustChain: Array<Credential> = [];

    let depth: number = 0;
    let assumedBy: string = principalArn;
    let credential: Credential;
    do {
      credential = await this.getCredentialByPrincipalArn(assumedBy);
      if (credential.assumedBy) {
        assumedBy = credential.assumedBy;
      }
      trustChain.push(credential);
    } while (credential.assumedBy && credential.assumedBy.length > 0 && ++depth <= this.principalTrustChainLimit);

    if (!credential.accessKeyId || !credential.secretAccessKey) {
      if (depth >= this.principalTrustChainLimit) {
        console.error('Principal chain exceeds the maximum allowed depth:', this.principalTrustChainLimit);
      }
      throw new InternalServerError('Principal chain is not valid. Contact system administrator.');
    }

    if (trustChain.length <= 1) {
      throw new ForbiddenError('For security reasons, long-term credentials are not retrievable.');
    }

    const principalArns: Array<string> = Array.from(trustChain, (trustedPrincipal) => trustedPrincipal.principalArn);
    return {
      principalArns: principalArns,
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
      sessionToken: credential.sessionToken,
    };
  }

  public async storeCredential(principalArn: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<void> {
    const encryptedAccessKeyId: { encrypted: string; iv: string } = await encryptData(accessKeyId, this.masterKey);
    const encryptedSecretAccessKey: { encrypted: string; iv: string } = await encryptData(
      secretAccessKey,
      this.masterKey,
      encryptedAccessKeyId.iv,
    );
    const encryptedSessionToken: { encrypted: string; iv: string } | null = sessionToken
      ? await encryptData(sessionToken, this.masterKey, encryptedAccessKeyId.iv)
      : null;
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR REPLACE INTO credentials (principal_arn, encrypted_access_key_id, encrypted_secret_access_key, encrypted_session_token, salt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        principalArn,
        encryptedAccessKeyId.encrypted,
        encryptedSecretAccessKey.encrypted,
        encryptedSessionToken?.encrypted || null,
        encryptedAccessKeyId.iv,
      )
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to store credential: ${result.error}`);
    }
  }

  public async storeCredentialRelationship(principalArn: string, assumedBy: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR REPLACE INTO credentials (principal_arn, assumed_by)
         VALUES (?, ?)`,
      )
      .bind(principalArn, assumedBy)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to store credential relationship: ${result.error}`);
    }
  }

  public async removeCredential(principalArn: string): Promise<void> {
    const result: D1Result = await this.database.prepare(`DELETE FROM credentials WHERE principal_arn = ?`).bind(principalArn).run();
    if (!result.success) {
      throw new DatabaseError(`Failed to remove credential: ${result.error}`);
    }
  }
}

export { CredentialsDAO };
