import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';

describe('User profile endpoints', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  it('returns the dev auth email for GET /user/me', async () => {
    const response: Response = await SELF.fetch('http://localhost/user/me', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ email: 'test@example.com', isSuperAdmin: false });
  });

  it('round-trips the language preference via PUT /user/me', async () => {
    const putResponse: Response = await SELF.fetch('http://localhost/user/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLanguage: 'de' }),
    });
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toMatchObject({ success: true, preferredLanguage: 'de' });

    const getResponse: Response = await SELF.fetch('http://localhost/user/me', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await getResponse.json()).toMatchObject({ preferredLanguage: 'de' });
  });

  it('serves the OpenAPI document', async () => {
    const response: Response = await SELF.fetch('http://localhost/openapi.json', { method: 'GET' });
    expect(response.status).toBe(200);
  });
});
