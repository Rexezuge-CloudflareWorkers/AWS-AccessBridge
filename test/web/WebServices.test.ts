import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addTeamAccount,
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamAccounts,
  listTeamMembers,
  listTeams,
  removeTeamAccount,
  removeTeamMember,
  renameTeam,
  updateTeamMemberRole,
} from '@aws-access-bridge/web/services/teamsService';
import { queryAuditLogs } from '@aws-access-bridge/web/services/auditService';
import { setAccountNickname, testCredentialChain, cleanupOrphaned } from '@aws-access-bridge/web/services/adminService';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
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

  it('teamsService sends every member and account mutation on its own verb', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input instanceof Request ? input.url : String(input), init]);
      return jsonResponse({});
    });

    await deleteTeam('t1');
    await renameTeam('t1', 'Blue');
    await addTeamMember('t1', 'a@e.com', 'admin');
    await removeTeamMember('t1', 'a@e.com');
    await updateTeamMemberRole('t1', 'a@e.com', 'member');
    await addTeamAccount('t1', '123456789012');
    await removeTeamAccount('t1', '123456789012');

    const verbs: string[] = calls.map(([, init]) => init?.method ?? 'GET');
    expect(verbs).toEqual(['DELETE', 'PUT', 'POST', 'DELETE', 'PUT', 'POST', 'DELETE']);
    expect(calls[2]?.[1]?.body).toContain('"role":"admin"');
  });

  it('teamsService tolerates a body without the list, rather than rendering undefined', async () => {
    // A 204 or an unexpected envelope must read as an empty list, not crash the
    // team view on `.map` of undefined.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(listTeams()).resolves.toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(listTeamMembers('t1')).resolves.toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(listTeamAccounts('t1')).resolves.toEqual([]);
  });

  it('team list queries carry the team id, URL-encoded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ members: [] }));
    await listTeamMembers('team 1/../x');
    const requested = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(requested instanceof Request ? requested.url : String(requested)).toContain('teamId=team%201%2F..%2Fx');
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
