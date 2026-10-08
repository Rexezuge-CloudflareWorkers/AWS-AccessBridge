import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations, migrationFileNames } from '../helpers/migrations';

/**
 * Personal access tokens are stored as SHA-256 digests (`0034_pat_hashed_tokens.sql`).
 *
 * The claim under test is that a row no longer carries the bearer credential:
 * a D1 read or a nightly backup must not hand out a working token.
 */
describe('PAT storage', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
    // The user row the token's foreign key targets.
    await SELF.fetch('http://localhost/user/me', { method: 'GET' });
  });

  it('migration 0034 is part of the applied set', () => {
    expect(migrationFileNames()).toContain('0034_pat_hashed_tokens.sql');
  });

  it('stores a digest, never the plaintext token', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hash-test-token' }),
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as { tokenId: string; token: string };

    const row = await env.AccessBridgeDB.prepare('SELECT * FROM user_access_tokens WHERE token_id = ?')
      .bind(created.tokenId)
      .first<Record<string, unknown>>();
    expect(row).toBeTruthy();
    // No `access_token` column survives the migration, and no column anywhere in
    // the row holds the plaintext.
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(String(row?.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('authenticates the minted token and refuses a near miss', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'auth-test-token' }),
    });
    const created = (await response.json()) as { token: string };

    const authed: Response = await SELF.fetch('http://localhost/api/aws/assume-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` },
      body: JSON.stringify({}),
    });
    // 400 = authenticated, invalid body; 401 would mean the hash lookup missed.
    expect(authed.status).toBe(400);

    const forged: Response = await SELF.fetch('http://localhost/api/aws/assume-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}x` },
      body: JSON.stringify({}),
    });
    expect(forged.status).toBe(401);
  });
});
