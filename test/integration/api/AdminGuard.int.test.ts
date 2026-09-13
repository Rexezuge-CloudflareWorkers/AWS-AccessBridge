import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';

// Offline-safe guard matrix: test@example.com is not a super-admin
// (see UserMe.int.test.ts), so every /user/admin/* route must 401
// (`IAdminActivityAPIRoute` throws `UnauthorizedError`) before touching
// D1/KV/AWS. Bodies are valid so validation passes and the guard is
// what rejects. /api/* without credentials must 401.
describe('Admin guard + programmatic auth matrix', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  const adminCalls: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/user/admin/audit-logs' },
    {
      method: 'POST',
      path: '/user/admin/credentials',
      body: { principalArn: 'arn:aws:iam::123456789012:role/Dev', accessKeyId: 'AKIA', secretAccessKey: 'SK' },
    },
    { method: 'POST', path: '/user/admin/access', body: { awsAccountId: '123456789012', roleName: 'Dev' } },
    { method: 'GET', path: '/user/admin/teams' },
    { method: 'POST', path: '/user/admin/team', body: { teamName: 'int-team' } },
    {
      method: 'POST',
      path: '/user/admin/collection/config',
      body: { principalArn: 'arn:aws:iam::123456789012:role/Dev', collectionTypes: ['cost'] },
    },
    { method: 'POST', path: '/user/admin/costs/alerts', body: { awsAccountId: '123456789012', thresholdAmount: 10 } },
    { method: 'POST', path: '/user/admin/maintenance/cleanup-orphaned', body: {} },
    { method: 'GET', path: '/user/admin/maintenance/task-runs' },
  ];

  for (const call of adminCalls) {
    it(`401s non-super-admin ${call.method} ${call.path}`, async () => {
      const response: Response = await SELF.fetch(`http://localhost${call.path}`, {
        method: call.method,
        headers: { 'Content-Type': 'application/json' },
        body: call.body ? JSON.stringify(call.body) : undefined,
      });
      expect(response.status).toBe(401);
    });
  }

  it('401s programmatic assume-role without credentials', async () => {
    const response: Response = await SELF.fetch('http://localhost/api/aws/assume-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('401s programmatic console without credentials', async () => {
    const response: Response = await SELF.fetch('http://localhost/api/aws/console', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('401s programmatic federate without credentials', async () => {
    const response: Response = await SELF.fetch('http://localhost/api/aws/federate', { method: 'GET' });
    expect(response.status).toBe(401);
  });
});
