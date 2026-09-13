import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';

// Offline-safe user-data matrix: empty-state reads plus a full PAT
// lifecycle (D1-only, no AWS network). Proves PAT auth end-to-end by
// using the minted token against /api/* (400 = auth passed, body
// invalid; 401 = auth failed).
describe('User data + PAT lifecycle', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  it('lists no assumable accounts for a fresh user', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/assumables', { method: 'GET' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toBeTruthy();
  });

  it('returns empty cost summary and resource inventory', async () => {
    const costs: Response = await SELF.fetch('http://localhost/user/costs/summary', { method: 'GET' });
    expect(costs.status).toBe(200);
    const resources: Response = await SELF.fetch('http://localhost/user/resources/summary', { method: 'GET' });
    expect(resources.status).toBe(200);
  });

  it('mints, lists, uses, and revokes a PAT', async () => {
    // Tokens FK to the user row — ensure it exists first.
    await SELF.fetch('http://localhost/user/me', { method: 'GET' });

    const createResponse: Response = await SELF.fetch('http://localhost/user/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'int-test-token' }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { tokenId: string; token: string };
    expect(created.token).toBeTruthy();

    const listResponse: Response = await SELF.fetch('http://localhost/user/tokens', { method: 'GET' });
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { tokens: Array<{ tokenId: string }> };
    expect(listed.tokens.map((t) => t.tokenId)).toContain(created.tokenId);

    // Authenticated but invalid body -> 400 proves the PAT verified.
    const authed: Response = await SELF.fetch('http://localhost/api/aws/assume-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` },
      body: JSON.stringify({}),
    });
    expect(authed.status).toBe(400);

    const deleteResponse: Response = await SELF.fetch('http://localhost/user/tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: created.tokenId }),
    });
    expect(deleteResponse.status).toBe(200);

    // Revoked token must 401 again.
    const revoked: Response = await SELF.fetch('http://localhost/api/aws/assume-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` },
      body: JSON.stringify({}),
    });
    expect(revoked.status).toBe(401);
  });
});
