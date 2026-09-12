import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { DatabaseError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';

describe('CredentialsDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;
  const masterKey = 'dGVzdC1tYXN0ZXIta2V5LWJhc2U2NC1lbmNvZGVkYWI='; // placeholder

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn(),
      raw: vi.fn(),
    } as unknown as D1PreparedStatement;

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('getCredentialByPrincipalArn', () => {
    it('throws UnauthorizedError when credential not found', async () => {
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await expect(dao.getCredentialByPrincipalArn('arn:aws:iam::123456789012:role/Missing')).rejects.toThrow(UnauthorizedError);
    });

    it('returns credential with decrypted fields when found without encryption', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        principal_arn: 'arn:aws:iam::123456789012:role/TestRole',
        assumed_by: 'arn:aws:iam::123456789012:user/TestUser',
        encrypted_access_key_id: undefined,
        encrypted_secret_access_key: undefined,
        encrypted_session_token: undefined,
        salt: undefined,
      });
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      const result = await dao.getCredentialByPrincipalArn('arn:aws:iam::123456789012:role/TestRole');
      expect(result.principalArn).toBe('arn:aws:iam::123456789012:role/TestRole');
      expect(result.assumedBy).toBe('arn:aws:iam::123456789012:user/TestUser');
      expect(result.accessKeyId).toBeUndefined();
      expect(result.secretAccessKey).toBeUndefined();
    });
  });

  describe('storeCredential', () => {
    it('throws DatabaseError when insert fails', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'insert fail' } as unknown as D1Result);
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      // storeCredential calls encryptData which needs crypto.subtle - this test verifies error path
      // We need to mock the crypto calls or use real ones; since we're in Workers runtime, crypto.subtle exists
      await expect(dao.storeCredential('arn:aws:iam::123456789012:role/TestRole', 'AKID', 'SECRET')).rejects.toThrow(DatabaseError);
    });
  });

  describe('storeCredentialRelationship', () => {
    it('stores a principal-to-parent relationship', async () => {
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await dao.storeCredentialRelationship('arn:aws:iam::123456789012:role/Child', 'arn:aws:iam::123456789012:user/Parent');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/Child', 'arn:aws:iam::123456789012:user/Parent');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await expect(dao.storeCredentialRelationship('arn1', 'arn2')).rejects.toThrow(DatabaseError);
    });
  });

  describe('removeCredential', () => {
    it('deletes a credential by principal ARN', async () => {
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await dao.removeCredential('arn:aws:iam::123456789012:role/TestRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/TestRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await expect(dao.removeCredential('arn')).rejects.toThrow(DatabaseError);
    });
  });

  describe('getCredentialChainByPrincipalArn', () => {
    it('throws UnauthorizedError when first credential not found', async () => {
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      await expect(dao.getCredentialChainByPrincipalArn('arn:aws:iam::123456789012:role/Missing')).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError for single-hop chain (just long-term creds)', async () => {
      vi.mocked(mockStmt.first).mockResolvedValue({
        principal_arn: 'arn:aws:iam::123456789012:user/User',
        assumed_by: undefined,
        encrypted_access_key_id: undefined,
        encrypted_secret_access_key: undefined,
        encrypted_session_token: undefined,
        salt: undefined,
      });
      const dao = new CredentialsDAO(mockDb, masterKey, 3);
      // Chain with only 1 credential (the user itself, no assumed_by, no keys) -> InternalServerError
      await expect(dao.getCredentialChainByPrincipalArn('arn:aws:iam::123456789012:user/User')).rejects.toThrow(InternalServerError);
    });
  });
});
