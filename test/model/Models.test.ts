import { describe, it, expect } from 'vitest';
import type { AccessableAccount, AccessableAccountInternal } from '@aws-access-bridge/shared/model/AccessableAccount';
import type { AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model/AccessKeys';
import type { Credential, CredentialInternal } from '@aws-access-bridge/shared/model/Credential';
import type { CredentialCache } from '@aws-access-bridge/shared/model/CredentialCache';
import type { CredentialChain } from '@aws-access-bridge/shared/model/CredentialChain';
import type { UserAccessToken, UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';
import type { UserMetadata, UserMetadataInternal } from '@aws-access-bridge/shared/model/UserMetadata';
import type { RoleConfig, RoleConfigInternal } from '@aws-access-bridge/shared/model/RoleConfig';
import type { AssumableAccount, AssumableAccountsMap } from '@aws-access-bridge/shared/model/AssumableAccount';

describe('Model Types', () => {
  describe('AccessableAccount', () => {
    it('can be created with required fields', () => {
      const account: AccessableAccount = { userEmail: 'user@test.com', awsAccountId: '123456789012' };
      expect(account.userEmail).toBe('user@test.com');
      expect(account.awsAccountId).toBe('123456789012');
    });

    it('internal model uses snake_case', () => {
      const internal: AccessableAccountInternal = { user_email: 'user@test.com', aws_account_id: '123456789012' };
      expect(internal.user_email).toBe('user@test.com');
    });
  });

  describe('AccessKeys', () => {
    it('can be created without session token', () => {
      const keys: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET' };
      expect(keys.sessionToken).toBeUndefined();
    });

    it('can be created with session token', () => {
      const keys: AccessKeys = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' };
      expect(keys.sessionToken).toBe('TOKEN');
    });

    it('extended version includes expiration', () => {
      const keys: AccessKeysWithExpiration = {
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
        expiration: '2026-01-01T00:00:00Z',
      };
      expect(keys.expiration).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('Credential', () => {
    it('can be created with minimal fields', () => {
      const cred: Credential = { principalArn: 'arn:aws:iam::123456789012:role/Test' };
      expect(cred.assumedBy).toBeUndefined();
    });

    it('internal model has encrypted fields', () => {
      const internal: CredentialInternal = {
        principal_arn: 'arn:aws:iam::123456789012:role/Test',
        encrypted_access_key_id: 'enc-akid',
        encrypted_secret_access_key: 'enc-sak',
        salt: 'iv-base64',
      };
      expect(internal.encrypted_access_key_id).toBe('enc-akid');
    });
  });

  describe('CredentialCache', () => {
    it('has all required fields', () => {
      const cache: CredentialCache = {
        principalArn: 'arn:aws:iam::123456789012:role/Test',
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
        expiresAt: 1700000000,
      };
      expect(cache.expiresAt).toBe(1700000000);
    });
  });

  describe('CredentialChain', () => {
    it('represents a simple 2-level chain', () => {
      const chain: CredentialChain = {
        principalArns: ['arn:aws:iam::123456789012:role/Target', 'arn:aws:iam::123456789012:user/Source'],
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
      };
      expect(chain.principalArns).toHaveLength(2);
      expect(chain.principalArns[0]).toContain('role/Target');
      expect(chain.principalArns[1]).toContain('user/Source');
    });

    it('represents a multi-level chain with session token', () => {
      const chain: CredentialChain = {
        principalArns: [
          'arn:aws:iam::111111111111:role/Target',
          'arn:aws:iam::222222222222:role/Intermediate',
          'arn:aws:iam::333333333333:user/Source',
        ],
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
      };
      expect(chain.principalArns).toHaveLength(3);
    });
  });

  describe('UserAccessToken', () => {
    it('extends metadata with access token', () => {
      const token: UserAccessToken = {
        tokenId: 'tid',
        userEmail: 'user@test.com',
        accessToken: 'secret-token',
        name: 'My Token',
        createdAt: 1700000000,
        expiresAt: 1800000000,
      };
      expect(token.accessToken).toBe('secret-token');
    });

    it('metadata has optional lastUsedAt', () => {
      const meta: UserAccessTokenMetadata = {
        tokenId: 'tid',
        userEmail: 'user@test.com',
        name: 'Token',
        createdAt: 100,
        expiresAt: 200,
      };
      expect(meta.lastUsedAt).toBeUndefined();
    });
  });

  describe('UserMetadata', () => {
    it('has all required fields', () => {
      const meta: UserMetadata = {
        userEmail: 'user@test.com',
        isSuperAdmin: true,
        federationUsername: 'ABCDEF123456',
      };
      expect(meta.isSuperAdmin).toBe(true);
    });

    it('internal model uses snake_case with optional fields', () => {
      const internal: UserMetadataInternal = {};
      expect(internal.user_email).toBeUndefined();
      expect(internal.is_superadmin).toBeUndefined();
    });
  });

  describe('RoleConfig', () => {
    it('has required and optional fields', () => {
      const config: RoleConfig = {
        awsAccountId: '123456789012',
        roleName: 'Admin',
        destinationPath: '/s3',
        destinationRegion: 'us-west-2',
        roleSessionDurationSeconds: 14400,
      };
      expect(config.destinationPath).toBe('/s3');
      expect(config.roleSessionDurationSeconds).toBe(14400);
    });

    it('internal model uses snake_case', () => {
      const internal: RoleConfigInternal = {
        aws_account_id: '123456789012',
        role_name: 'Admin',
      };
      expect(internal.destination_path).toBeUndefined();
      expect(internal.role_session_duration_seconds).toBeUndefined();
    });
  });

  describe('AssumableAccount', () => {
    it('has roles array and optional fields', () => {
      const account: AssumableAccount = {
        roles: ['Admin', 'ReadOnly'],
        nickname: 'Production',
        favorite: true,
      };
      expect(account.roles).toHaveLength(2);
    });

    it('map type maps account IDs to accounts', () => {
      const map: AssumableAccountsMap = {
        '123456789012': { roles: ['Admin'], nickname: 'Dev' },
        '987654321098': { roles: ['ReadOnly'] },
      };
      expect(Object.keys(map)).toHaveLength(2);
    });
  });
});
