import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTeams, createTeam, addTeamMember, listTeamAccounts } from '@aws-access-bridge/web/services/teamsService';
import { queryAuditLogs } from '@aws-access-bridge/web/services/auditService';
import { setAccountNickname, testCredentialChain, cleanupOrphaned } from '@aws-access-bridge/web/services/adminService';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('web domain services', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('teamsService lists, creates, and mutates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ teams: [{ teamId: 't1' }] }));
    await expect(listTeams()).resolves.toEqual([{ teamId: 't1' }]);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ team: { teamId: 't2' } }));
    await expect(createTeam('Blue')).resolves.toEqual({ teamId: 't2' });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await addTeamMember('t1', 'user@example.com', 'member');
    const addCall = vi.mocked(fetch).mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST');
    expect(addCall?.[1]).toMatchObject({ method: 'POST' });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ accountIds: ['123456789012'] }));
    await expect(listTeamAccounts('t1')).resolves.toEqual(['123456789012']);
  });

  it('auditService queries with filters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ logs: [], total: 0 }));
    await expect(queryAuditLogs({ userEmail: 'u@e.com', limit: 10 })).resolves.toEqual({ logs: [], total: 0 });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('userEmail=u%40e.com');
  });

  it('adminService wraps mutations', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await setAccountNickname('123456789012', 'Dev');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, chain: [] }));
    await expect(testCredentialChain('arn')).resolves.toMatchObject({ success: true });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ deleted: 3 }));
    await expect(cleanupOrphaned()).resolves.toEqual({ deleted: 3 });
  });

  it('propagates backend failures as ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ Exception: { Message: 'Denied' } }, 403));
    await expect(listTeams()).rejects.toThrow('Denied');
  });
});
