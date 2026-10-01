import { DatabaseError, ForbiddenError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { Credential, CredentialChain, CredentialInternal } from '@aws-access-bridge/shared/model';
import { decryptDataField, encryptData } from '@aws-access-bridge/backend-data/crypto/aes-gcm';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { EncryptedDAO } from './BaseDAO';

/**
 * Pick the IV to decrypt a credential field with.
 *
 * Rows written before migration `0031_distinct_credential_ivs.sql` encrypted
 * every field under the single IV in `salt`, so an absent per-field column means
 * "legacy row" and `salt` is the correct IV. Such rows keep decrypting and are
 * rewritten with distinct IVs on their next store.
 */
function resolveIv(fieldIv: string | undefined, legacySalt: string | undefined): string | undefined {
  return fieldIv ?? legacySalt;
}

class CredentialsDAO extends EncryptedDAO {
  protected readonly principalTrustChainLimit: number;

  constructor(database: D1Queryable, encryptionKeys: readonly string[], principalTrustChainLimit: number) {
    super(database, encryptionKeys);
    this.principalTrustChainLimit = principalTrustChainLimit;
  }

  public async getCredentialByPrincipalArn(principalArn: string): Promise<Credential> {
    const result: CredentialInternal | null = await this.database
      .prepare(
        `SELECT principal_arn, assumed_by, encrypted_access_key_id, encrypted_secret_access_key, encrypted_session_token,
                salt, salt_secret_access_key, salt_session_token
         FROM credentials
         WHERE principal_arn = ?
         LIMIT 1`,
      )
      .bind(principalArn)
      .first<CredentialInternal>();

    if (!result) {
      throw new UnauthorizedError();
    }

    const keys = this.encryptionKeys;
    // A relationship-only row carries no ciphertext at all, so `decryptDataField`
    // answers `undefined` for an absent envelope and throws only when an envelope
    // is present but no key authenticates it.
    return {
      principalArn: result.principal_arn,
      assumedBy: result.assumed_by,
      // Each field falls back through the key chain independently: a row rewritten
      // since the per-feature split has all three on the current key, a row
      // untouched since has all three on the legacy one.
      accessKeyId: await decryptDataField(result.encrypted_access_key_id, result.salt, keys),
      secretAccessKey: await decryptDataField(result.encrypted_secret_access_key, resolveIv(result.salt_secret_access_key, result.salt), keys),
      sessionToken: await decryptDataField(result.encrypted_session_token, resolveIv(result.salt_session_token, result.salt), keys),
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
      // `++depth < limit`, not `<=`: this is a do/while, so the increment runs in
      // the condition and `<=` would admit `limit + 1` hops.
    } while (credential.assumedBy && credential.assumedBy.length > 0 && ++depth < this.principalTrustChainLimit);

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
    // Distinct IV per field: a shared nonce would make the three ciphertexts
    // cancel to the XOR of their plaintexts and would expose the GCM auth
    // subkey. `encryptData` generates each IV, and each travels with its own
    // ciphertext into its own column.
    // Always the surface's own key: this is what upgrades a legacy row.
    const key = this.encryptionKey;
    const encryptedAccessKeyId = await encryptData(accessKeyId, key);
    const encryptedSecretAccessKey = await encryptData(secretAccessKey, key);
    const encryptedSessionToken = sessionToken ? await encryptData(sessionToken, key) : null;
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR REPLACE INTO credentials (
           principal_arn, encrypted_access_key_id, encrypted_secret_access_key, encrypted_session_token,
           salt, salt_secret_access_key, salt_session_token
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        principalArn,
        encryptedAccessKeyId.encrypted,
        encryptedSecretAccessKey.encrypted,
        encryptedSessionToken?.encrypted || null,
        encryptedAccessKeyId.iv,
        encryptedSecretAccessKey.iv,
        encryptedSessionToken?.iv || null,
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
