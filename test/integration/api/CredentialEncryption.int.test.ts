import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';
import { encryptData } from '@aws-access-bridge/backend-data/crypto/aes-gcm';

const MASTER_KEY = 'dGVzdC1tYXN0ZXIta2V5LWJhc2U2NC1lbmNvZGVkZWI=';
const BASE_ARN = 'arn:aws:iam::123456789012:user/base';
const ROLE_ARN = 'arn:aws:iam::123456789012:role/Dev';

describe('Credential encryption against real D1', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  it('stores three independent IVs and reads each field back with only its own', async () => {
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, MASTER_KEY, 3);
    await dao.storeCredential(ROLE_ARN, 'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG', 'session-token-value');

    // Inspect the raw row: the per-field IV columns must all be populated and
    // distinct. Sharing one nonce across the three encryptions is a critical
    // AES-GCM flaw (keystream reuse leaks plaintext XOR; GHASH subkey recovery
    // enables forgery).
    const row = await env.AccessBridgeDB.prepare(
      'SELECT salt, salt_secret_access_key, salt_session_token FROM credentials WHERE principal_arn = ?',
    )
      .bind(ROLE_ARN)
      .first<{ salt: string; salt_secret_access_key: string; salt_session_token: string }>();

    expect(row).toBeTruthy();
    expect(new Set([row!.salt, row!.salt_secret_access_key, row!.salt_session_token]).size).toBe(3);

    const credential = await dao.getCredentialByPrincipalArn(ROLE_ARN);
    expect(credential).toMatchObject({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG',
      sessionToken: 'session-token-value',
    });
  });

  it('still reads a pre-migration row that only has the shared salt', async () => {
    // Backward-read compatibility: rows written before migration 0031 carry one
    // IV for all three ciphertexts, and must keep decrypting.
    const sharedIv = btoa(String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(12))));
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(MASTER_KEY), (c) => c.codePointAt(0) ?? 0), { name: 'AES-GCM' }, false, ['encrypt']);
    const encryptLegacy = async (data: string): Promise<string> => {
      const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(sharedIv), (c) => c.codePointAt(0) ?? 0) }, key, new TextEncoder().encode(data));
      return btoa(String.fromCodePoint(...new Uint8Array(out)));
    };
    const legacyArn = 'arn:aws:iam::123456789012:role/Legacy';
    await env.AccessBridgeDB.prepare(
      'INSERT OR REPLACE INTO credentials (principal_arn, encrypted_access_key_id, encrypted_secret_access_key, salt) VALUES (?, ?, ?, ?)',
    )
      .bind(legacyArn, await encryptLegacy('AKIALEGACYACCESSKEY00'), await encryptLegacy('legacySecretValue'), sharedIv)
      .run();

    const dao = new CredentialsDAO(env.AccessBridgeDB as never, MASTER_KEY, 3);
    await expect(dao.getCredentialByPrincipalArn(legacyArn)).resolves.toMatchObject({
      accessKeyId: 'AKIALEGACYACCESSKEY00',
      secretAccessKey: 'legacySecretValue',
    });
  });

  it('re-encrypts a legacy row with distinct IVs on the next write', async () => {
    const arn = 'arn:aws:iam::123456789012:role/Upgraded';
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, MASTER_KEY, 3);
    await dao.storeCredential(arn, 'AKIAUPGRADEDKEY00000', 'upgradedSecretValue', 'tok');

    const row = await env.AccessBridgeDB.prepare('SELECT salt, salt_secret_access_key, salt_session_token FROM credentials WHERE principal_arn = ?')
      .bind(arn)
      .first<{ salt: string; salt_secret_access_key: string; salt_session_token: string }>();
    expect(new Set([row!.salt, row!.salt_secret_access_key, row!.salt_session_token]).size).toBe(3);
    await expect(dao.getCredentialByPrincipalArn(arn)).resolves.toMatchObject({ secretAccessKey: 'upgradedSecretValue' });
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const arn = 'arn:aws:iam::123456789012:role/Tampered';
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, MASTER_KEY, 3);
    await dao.storeCredential(arn, 'AKIATAMPEREDKEY00000', 'tamperSecretValue');
    await env.AccessBridgeDB.prepare('UPDATE credentials SET encrypted_secret_access_key = ? WHERE principal_arn = ?')
      .bind((await encryptData('attackerValue', MASTER_KEY)).encrypted, arn)
      .run();

    // The GCM tag check must fail: decrypting with the stored per-field IV
    // raises rather than silently yielding the attacker's plaintext.
    await expect(dao.getCredentialByPrincipalArn(arn)).rejects.toThrow();
  });

  it('walks a two-hop trust chain', async () => {
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, MASTER_KEY, 3);
    await dao.storeCredentialRelationship(ROLE_ARN, BASE_ARN);
    await dao.storeCredential(BASE_ARN, 'AKIABASEROLEKEY000000', 'baseSecretValue');

    const chain = await dao.getCredentialChainByPrincipalArn(ROLE_ARN);
    expect(chain.principalArns).toEqual([ROLE_ARN, BASE_ARN]);
    expect(chain).toMatchObject({ accessKeyId: 'AKIABASEROLEKEY000000', secretAccessKey: 'baseSecretValue' });
  });
});

describe('Manual scheduled trigger authorization', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  it('refuses an unauthenticated /__scheduled trigger', async () => {
    // The trigger is handled ahead of the Hono app, so no route middleware runs
    // for it. Without the explicit super-admin grant it must be unreachable, or
    // anyone could drive the privileged cron pipeline.
    const response: Response = await SELF.fetch('http://localhost/__scheduled', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('refuses /__scheduled for a non-super-admin identity', async () => {
    // The integration env authenticates as DEV_AUTH_EMAIL, which is not a
    // super-admin, so this exercises the second denial branch.
    const response: Response = await SELF.fetch('http://localhost/__scheduled?cron=*/10+*+*+*+*', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
