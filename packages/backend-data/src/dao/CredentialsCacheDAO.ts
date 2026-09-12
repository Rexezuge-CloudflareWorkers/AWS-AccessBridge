import { CredentialCache } from '@aws-access-bridge/shared/model/CredentialCache';
import { decryptData, encryptData } from '@aws-access-bridge/backend-data/crypto/aes-gcm';
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
    if (cached) {
      const currentTime: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
      if (cached.expiresAt > currentTime) {
        return {
          principalArn,
          accessKeyId: await decryptData(cached.encryptedAccessKeyId, cached.salt, this.masterKey),
          secretAccessKey: await decryptData(cached.encryptedSecretAccessKey, cached.salt, this.masterKey),
          sessionToken: await decryptData(cached.encryptedSessionToken, cached.salt, this.masterKey),
          expiresAt: cached.expiresAt,
        };
      }
      await this.delete(principalArn);
    }
    return undefined;
  }

  public async storeCachedCredential(credential: CredentialCache): Promise<void> {
    const { encrypted: encryptedAccessKeyId, iv } = await encryptData(credential.accessKeyId, this.masterKey);
    const { encrypted: encryptedSecretAccessKey } = await encryptData(credential.secretAccessKey, this.masterKey, iv);
    const { encrypted: encryptedSessionToken } = await encryptData(credential.sessionToken, this.masterKey, iv);

    const data: CachedCredentialData = {
      encryptedAccessKeyId,
      encryptedSecretAccessKey,
      encryptedSessionToken,
      salt: iv,
      expiresAt: credential.expiresAt,
    };
    const ttl: number = Math.max(credential.expiresAt - TimestampUtil.getCurrentUnixTimestampInSeconds(), KV_MINIMUM_TIVE_TO_LIVE_SECONDS);
    await this.put(credential.principalArn, data, { expirationTtl: ttl });
  }
}

interface CachedCredentialData {
  encryptedAccessKeyId: string;
  encryptedSecretAccessKey: string;
  encryptedSessionToken: string;
  salt: string;
  expiresAt: number;
}

export { CredentialsCacheDAO };
