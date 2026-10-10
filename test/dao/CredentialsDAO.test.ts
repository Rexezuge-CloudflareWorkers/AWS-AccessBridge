import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { DatabaseError, InternalServerError, NotFoundError } from '@aws-access-bridge/backend-errors';
import { encryptData, generateAESGCMKey } from '@aws-access-bridge/backend-data/crypto/aes-gcm';

/**
 * Produce a ciphertext the way pre-migration code did: caller-supplied IV,
 * which is exactly the nonce reuse this fix removed. Only for building legacy
 * fixture rows; production `encryptData` no longer accepts an IV.
 */
async function encryptDataWithIv(data: string, keyBase64: string, ivBase64: string): Promise<{ encrypted: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(keyBase64), (c) => c.codePointAt(0) ?? 0),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(ivBase64), (c) => c.codePointAt(0) ?? 0) },
    key,
    new TextEncoder().encode(data),
  );
  return { encrypted: btoa(String.fromCodePoint(...new Uint8Array(encrypted))) };
}

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
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('getCredentialByPrincipalArn', () => {
    // Not 401: the SPA treats a 401 as "your session ended" and bounces to the
    // login page, which cannot fix a principal with no stored credentials.
    it('throws NotFoundError when credential not found', async () => {
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await expect(dao.getCredentialByPrincipalArn('arn:aws:iam::123456789012:role/Missing')).rejects.toThrow(NotFoundError);
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
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
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
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      // storeCredential calls encryptData which needs crypto.subtle - this test verifies error path
      // We need to mock the crypto calls or use real ones; since we're in Workers runtime, crypto.subtle exists
      await expect(dao.storeCredential('arn:aws:iam::123456789012:role/TestRole', 'AKID', 'SECRET')).rejects.toThrow(DatabaseError);
    });

    it('persists a distinct IV per encrypted field', async () => {
      // Regression guard for the AES-GCM nonce-reuse flaw: a single shared IV
      // made the CTR keystream repeat, so XORing two ciphertexts leaked the XOR
      // of their plaintexts and the GCM auth subkey became recoverable.
      const key = await generateAESGCMKey();
      const dao = new CredentialsDAO(mockDb, [key], 3);
      await dao.storeCredential(
        'arn:aws:iam::123456789012:role/TestRole',
        'AKIAIOSFODNN7EXAMPLE',
        'wJalrXUtnFEMI/K7MDENG',
        'session-token',
      );

      const [, ...bound] = vi.mocked(mockStmt.bind).mock.calls[0] as unknown as string[];
      const [accessKeyId, secretAccessKey, sessionToken, ivA, ivB, ivC] = bound.slice(0, 6);
      expect(new Set([ivA, ivB, ivC]).size).toBe(3);

      // Every field must round-trip using only its own IV.
      const row = {
        principal_arn: 'arn:aws:iam::123456789012:role/TestRole',
        encrypted_access_key_id: accessKeyId,
        encrypted_secret_access_key: secretAccessKey,
        encrypted_session_token: sessionToken,
        salt: ivA,
        salt_secret_access_key: ivB,
        salt_session_token: ivC,
      };
      vi.mocked(mockStmt.first).mockResolvedValue(row);
      await expect(dao.getCredentialByPrincipalArn(row.principal_arn)).resolves.toMatchObject({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG',
        sessionToken: 'session-token',
      });
    });
  });

  describe('legacy single-IV rows', () => {
    it('decrypts rows written before the per-field IV migration', async () => {
      // Backward-read compatibility: existing production rows carry only
      // `salt`, shared across all three fields. They must keep decrypting and
      // are re-encrypted with distinct IVs on their next store.
      const key = await generateAESGCMKey();
      const sharedIv = btoa(String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(12))));
      const legacy = await Promise.all([
        encryptDataWithIv('AKIAIOSFODNN7EXAMPLE', key, sharedIv),
        encryptDataWithIv('wJalrXUtnFEMI/K7MDENG', key, sharedIv),
      ]);
      vi.mocked(mockStmt.first).mockResolvedValue({
        principal_arn: 'arn:aws:iam::123456789012:role/Legacy',
        assumed_by: undefined,
        encrypted_access_key_id: legacy[0].encrypted,
        encrypted_secret_access_key: legacy[1].encrypted,
        encrypted_session_token: undefined,
        salt: sharedIv,
      });

      const dao = new CredentialsDAO(mockDb, [key], 3);
      const result = await dao.getCredentialByPrincipalArn('arn:aws:iam::123456789012:role/Legacy');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG');
    });

    it('prefers the per-field IV over the legacy salt when both are present', async () => {
      const key = await generateAESGCMKey();
      const wrongIv = btoa(String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(12))));
      const correct = await encryptData('wJalrXUtnFEMI/K7MDENG', key);
      vi.mocked(mockStmt.first).mockResolvedValue({
        principal_arn: 'arn:aws:iam::123456789012:role/Upgraded',
        encrypted_secret_access_key: correct.encrypted,
        // A stale row whose per-field IV is set must not fall back to `salt`.
        salt: wrongIv,
        salt_secret_access_key: correct.iv,
      });

      const dao = new CredentialsDAO(mockDb, [key], 3);
      await expect(dao.getCredentialByPrincipalArn('arn:aws:iam::123456789012:role/Upgraded')).resolves.toMatchObject({
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG',
      });
    });
  });

  describe('storeCredentialRelationship', () => {
    it('stores a principal-to-parent relationship', async () => {
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await dao.storeCredentialRelationship('arn:aws:iam::123456789012:role/Child', 'arn:aws:iam::123456789012:user/Parent');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT(principal_arn) DO UPDATE SET assumed_by = excluded.assumed_by'),
      );
      expect(mockStmt.bind).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/Child', 'arn:aws:iam::123456789012:user/Parent');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await expect(dao.storeCredentialRelationship('arn1', 'arn2')).rejects.toThrow(DatabaseError);
    });
  });

  describe('removeCredential', () => {
    it('deletes a credential by principal ARN', async () => {
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await dao.removeCredential('arn:aws:iam::123456789012:role/TestRole');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));
      expect(mockStmt.bind).toHaveBeenCalledWith('arn:aws:iam::123456789012:role/TestRole');
    });

    it('throws DatabaseError on failure', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: false, error: 'fail' } as unknown as D1Result);
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await expect(dao.removeCredential('arn')).rejects.toThrow(DatabaseError);
    });
  });

  describe('getCredentialChainByPrincipalArn', () => {
    it('throws NotFoundError when first credential not found', async () => {
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      await expect(dao.getCredentialChainByPrincipalArn('arn:aws:iam::123456789012:role/Missing')).rejects.toThrow(NotFoundError);
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
      const dao = new CredentialsDAO(mockDb, [masterKey], 3);
      // Chain with only 1 credential (the user itself, no assumed_by, no keys) -> InternalServerError
      await expect(dao.getCredentialChainByPrincipalArn('arn:aws:iam::123456789012:user/User')).rejects.toThrow(InternalServerError);
    });
  });

  describe('chain depth limit', () => {
    const LEAF = 'arn:aws:iam::123456789012:role/Leaf';
    const MID = 'arn:aws:iam::123456789012:role/Mid';
    const MID_TWO = 'arn:aws:iam::123456789012:role/MidTwo';
    const BASE = 'arn:aws:iam::123456789012:user/Base';

    /**
     * Binds each ARN to its own row so the walk is a real multi-hop traversal
     * rather than one row answered repeatedly. `keys: true` writes genuine
     * ciphertext, so the walk decrypts long-term credentials the way it would in
     * production rather than stubbing the field to a truthy value.
     */
    async function seedChain(rows: Record<string, { assumedBy?: string; keys?: boolean }>, key: string): Promise<void> {
      let boundArn = '';
      vi.mocked(mockStmt.bind).mockImplementation((...args: unknown[]) => {
        boundArn = String(args[0]);
        return mockStmt;
      });
      const encrypted = new Map<string, { id: string; secret: string; salt: string; saltSecret: string }>();
      for (const [arn, row] of Object.entries(rows)) {
        if (!row.keys) {
          continue;
        }

        const id = await encryptData('AKIAIOSFODNN7EXAMPLE', key);
        const secret = await encryptData('wJalrXUtnFEMI/K7MDENG', key);
        encrypted.set(arn, { id: id.encrypted, secret: secret.encrypted, salt: id.iv, saltSecret: secret.iv });
      }
      vi.mocked(mockStmt.first).mockImplementation(async () => {
        const row = rows[boundArn];
        if (!row) return null;
        const enc = encrypted.get(boundArn);
        return {
          principal_arn: boundArn,
          assumed_by: row.assumedBy,
          encrypted_access_key_id: enc?.id,
          encrypted_secret_access_key: enc?.secret,
          encrypted_session_token: undefined,
          salt: enc?.salt,
          salt_secret_access_key: enc?.saltSecret,
          salt_session_token: undefined,
        };
      });
    }

    it('rejects an over-long chain even when the boundary row carries long-term keys', async () => {
      // The truncation regression. An operator can store credentials for any
      // principal ARN, so the row a walk stops on may hold keys — and key presence
      // says nothing about whether the chain is over-long. Treating it as the base
      // served this 4-principal chain as a working 3-hop prefix, with no error and
      // no log, while the documented promise was that the limit raises.
      const key = await generateAESGCMKey();
      await seedChain(
        {
          [LEAF]: { assumedBy: MID },
          [MID]: { assumedBy: MID_TWO },
          [MID_TWO]: { assumedBy: BASE, keys: true },
          [BASE]: { keys: true },
        },
        key,
      );
      const dao = new CredentialsDAO(mockDb, [key], 3);
      await expect(dao.getCredentialChainByPrincipalArn(LEAF)).rejects.toThrow('Principal chain exceeds the maximum allowed depth');
    });

    it('rejects an over-long chain whose boundary row is a bare relationship', async () => {
      const key = await generateAESGCMKey();
      await seedChain(
        {
          [LEAF]: { assumedBy: MID },
          [MID]: { assumedBy: MID_TWO },
          [MID_TWO]: { assumedBy: BASE },
          [BASE]: { keys: true },
        },
        key,
      );
      const dao = new CredentialsDAO(mockDb, [key], 3);
      await expect(dao.getCredentialChainByPrincipalArn(LEAF)).rejects.toThrow('Principal chain exceeds the maximum allowed depth');
    });

    it('accepts a chain that ends exactly at the limit', async () => {
      // The boundary is where a walk stops, not a length that is refused: three
      // principals with the third holding the keys is the deepest legal chain.
      const key = await generateAESGCMKey();
      await seedChain({ [LEAF]: { assumedBy: MID }, [MID]: { assumedBy: BASE }, [BASE]: { keys: true } }, key);
      const dao = new CredentialsDAO(mockDb, [key], 3);
      await expect(dao.getCredentialChainByPrincipalArn(LEAF)).resolves.toMatchObject({
        principalArns: [LEAF, MID, BASE],
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      });
    });

    it('terminates on a cyclic relation instead of walking it', async () => {
      // The depth bound used to live in the `while` condition; it is now the throw
      // inside the loop, which is what still stops P -> h1 -> P.
      const key = await generateAESGCMKey();
      await seedChain({ [LEAF]: { assumedBy: MID }, [MID]: { assumedBy: LEAF, keys: true } }, key);
      const dao = new CredentialsDAO(mockDb, [key], 3);
      await expect(dao.getCredentialChainByPrincipalArn(LEAF)).rejects.toThrow('Principal chain exceeds the maximum allowed depth');
    });
  });
});
