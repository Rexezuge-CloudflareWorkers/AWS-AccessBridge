import { CredentialCache } from '@aws-access-bridge/shared/model/CredentialCache';
import { decryptDataTolerant, encryptData } from '@aws-access-bridge/backend-data/crypto/aes-gcm';
import { TimestampUtil } from '@aws-access-bridge/shared/utils/TimestampUtil';
import { KV_MINIMUM_TIVE_TO_LIVE_SECONDS, KV_NAMESPACE_CREDENTIAL_CACHE } from '@aws-access-bridge/backend-data/constants/kv';
import { IKeyValueDAO } from './IKeyValueDAO';

class CredentialsCacheDAO extends IKeyValueDAO {
  protected readonly masterKey: string;

  constructor(kv: KVNamespace, masterKey: string) {
    super(kv, KV_NAMESPACE_CREDENTIAL_CACHE);
    this.masterKey = masterKey;
  }

  public async getCachedCredential(principalArn: string): Promise<CredentialCache | undefined> {
    const cached: CachedCredentialData | null = await this.get<CachedCredentialData>(principalArn);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= TimestampUtil.getCurrentUnixTimestampInSeconds()) {
      await this.delete(principalArn);
      return undefined;
    }

    // Each field carries its own IV; sharing one across fields would be an
    // AES-GCM nonce-reuse flaw. Entries written before that fix have only
    // `salt`, so fall back to it.
    const [accessKeyId, secretAccessKey, sessionToken] = await Promise.all([
      decryptDataTolerant(cached.encryptedAccessKeyId, cached.salt, this.masterKey),
      decryptDataTolerant(cached.encryptedSecretAccessKey, cached.saltSecretAccessKey ?? cached.salt, this.masterKey),
      decryptDataTolerant(cached.encryptedSessionToken, cached.saltSessionToken ?? cached.salt, this.masterKey),
    ]);

    // A key pair is mandatory; a session token is not (longer-lived or
    // non-session credentials have none). Anything present-but-unreadable means
    // a corrupt, tampered or key-rotated entry, so treat it as a miss — the
    // chain can always be re-resolved for the principal ARN.
    const sessionTokenUnreadable = cached.encryptedSessionToken !== undefined && sessionToken === undefined;
    if (accessKeyId === undefined || secretAccessKey === undefined || sessionTokenUnreadable) {
      await this.delete(principalArn);
      return undefined;
    }

    return { principalArn, accessKeyId, secretAccessKey, sessionToken, expiresAt: cached.expiresAt };
  }

  public async storeCachedCredential(credential: CredentialCache): Promise<void> {
    // The cache exists to short-circuit chain walks for temporary credentials,
    // which are only useful with their session token. Refuse to persist a
    // tokenless entry rather than cache something unusable.
    if (!credential.sessionToken) {
      return;
    }
    const encryptedAccessKeyId = await encryptData(credential.accessKeyId, this.masterKey);
    const encryptedSecretAccessKey = await encryptData(credential.secretAccessKey, this.masterKey);
    const encryptedSessionToken = await encryptData(credential.sessionToken, this.masterKey);

    const data: CachedCredentialData = {
      encryptedAccessKeyId: encryptedAccessKeyId.encrypted,
      encryptedSecretAccessKey: encryptedSecretAccessKey.encrypted,
      encryptedSessionToken: encryptedSessionToken.encrypted,
      salt: encryptedAccessKeyId.iv,
      saltSecretAccessKey: encryptedSecretAccessKey.iv,
      saltSessionToken: encryptedSessionToken.iv,
      expiresAt: credential.expiresAt,
    };
    const ttl: number = Math.max(credential.expiresAt - TimestampUtil.getCurrentUnixTimestampInSeconds(), KV_MINIMUM_TIVE_TO_LIVE_SECONDS);
    await this.put(credential.principalArn, data, { expirationTtl: ttl });
  }
}

/**
 * Serialized cache entry. The encrypted fields are optional because entries
 * written before IVs were split per field carry only the shared `salt`, and a
 * session token may legitimately be absent — reads must not treat "missing" as
 * "corrupt", which is why the corruption check tests the ciphertext actually
 * being present.
 */
interface CachedCredentialData {
  encryptedAccessKeyId?: string;
  encryptedSecretAccessKey?: string;
  encryptedSessionToken?: string;
  /**
  IV for `encryptedAccessKeyId`; also the legacy shared IV for pre-split entries.
  */
  salt?: string;
  /**
  Absent on entries written before IVs were split per field.
  */
  saltSecretAccessKey?: string;
  /**
  Absent on entries written before IVs were split per field.
  */
  saltSessionToken?: string;
  expiresAt: number;
}

export { CredentialsCacheDAO };
