import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTeamRoute } from '@/endpoints/user/admin/team/POST';
import { DeleteTeamRoute } from '@/endpoints/user/admin/team/DELETE';
import { ListTeamsRoute } from '@/endpoints/user/admin/teams/GET';
import { UpdateTeamNameRoute } from '@/endpoints/user/admin/team/name/PUT';
import { AddTeamMemberRoute } from '@/endpoints/user/admin/team/member/POST';
import { RemoveTeamMemberRoute } from '@/endpoints/user/admin/team/member/DELETE';
import { ListTeamMembersRoute } from '@/endpoints/user/admin/team/members/GET';
import { UpdateTeamMemberRoleRoute } from '@/endpoints/user/admin/team/member/role/PUT';
import { AddTeamAccountRoute } from '@/endpoints/user/admin/team/account/POST';
import { RemoveTeamAccountRoute } from '@/endpoints/user/admin/team/account/DELETE';
import { ListTeamAccountsRoute } from '@/endpoints/user/admin/team/accounts/GET';
import { TeamsDAO } from '@aws-access-bridge/backend-data/dao/TeamsDAO';
import { TeamMembersDAO } from '@aws-access-bridge/backend-data/dao/TeamMembersDAO';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';
import { createRouteContext } from '../helpers/route-context';

vi.mock('@aws-access-bridge/backend-data/dao/TeamsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamMembersDAO');
vi.mock('@aws-access-bridge/backend-data/dao/TeamAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/AwsAccountsDAO');
vi.mock('@aws-access-bridge/backend-data/dao/UserMetadataDAO');
// Migration 0032: account resolution consults the address registry before the
// anchor, so this suite stubs `UserEmailDAO` alongside `UserMetadataDAO`. The
// automock resolves undefined, which `UserIdentityService` reads as "no
// registry row" and falls through to the anchor - the pre-0032 path these
// route tests already assume.
vi.mock('@aws-access-bridge/backend-data/dao/UserEmailDAO');

function adminEnv() {
  vi.mocked(UserMetadataDAO.prototype.isSuperAdmin).mockResolvedValue(true);
  return {};
}

describe('team CRUD routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/team creates teams', async () => {
    vi.mocked(TeamsDAO.prototype.createTeam).mockResolvedValue({ teamId: 't1', teamName: 'Ops', createdAt: 1, createdBy: 'u@e.c' });
    const c = createRouteContext({ method: 'POST', body: { teamName: 'Ops' }, env: adminEnv() });
    await new CreateTeamRoute({} as never).handle(c);
    expect(TeamsDAO.prototype.createTeam).toHaveBeenCalledWith('Ops', 'user@example.com');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/team protects the default team', async () => {
    const c = createRouteContext({
      method: 'DELETE',
      body: { teamId: '00000000-0000-0000-0000-000000000000' },
      env: adminEnv(),
    });
    await new DeleteTeamRoute({} as never).handle(c);
    expect(TeamsDAO.prototype.deleteTeam).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('DELETE /user/admin/team removes teams', async () => {
    vi.mocked(TeamsDAO.prototype.deleteTeam).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'DELETE', body: { teamId: 't1' }, env: adminEnv() });
    await new DeleteTeamRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('GET /user/admin/teams lists teams', async () => {
    vi.mocked(TeamsDAO.prototype.listTeams).mockResolvedValue([]);
    const c = createRouteContext({ url: 'https://example.com/user/admin/teams', env: adminEnv() });
    await new ListTeamsRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ teams: [] }));
  });

  it('PUT /user/admin/team/name renames teams', async () => {
    vi.mocked(TeamsDAO.prototype.updateTeamName).mockResolvedValue(undefined);
    const c = createRouteContext({ method: 'PUT', body: { teamId: 't1', teamName: 'New' }, env: adminEnv() });
    await new UpdateTeamNameRoute({} as never).handle(c);
    expect(TeamsDAO.prototype.updateTeamName).toHaveBeenCalledWith('t1', 'New');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('team member routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/team/member adds members', async () => {
    vi.mocked(TeamMembersDAO.prototype.addMember).mockResolvedValue(1);
    const c = createRouteContext({
      method: 'POST',
      body: { teamId: 't1', userEmail: 'dev@example.com', role: 'member' },
      env: adminEnv(),
    });
    await new AddTeamMemberRoute({} as never).handle(c);
    expect(TeamMembersDAO.prototype.addMember).toHaveBeenCalledWith('t1', { userId: null, anchorEmail: 'dev@example.com' }, 'member');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/team/member removes members', async () => {
    vi.mocked(TeamMembersDAO.prototype.removeMember).mockResolvedValue(1);
    const c = createRouteContext({
      method: 'DELETE',
      body: { teamId: 't1', userEmail: 'dev@example.com' },
      env: adminEnv(),
    });
    await new RemoveTeamMemberRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('GET /user/admin/team/members requires a team id', async () => {
    vi.mocked(TeamMembersDAO.prototype.getMembersByTeam).mockResolvedValue([]);
    const c = createRouteContext({
      url: 'https://example.com/user/admin/team/members?teamId=11111111-1111-4111-8111-111111111111',
      env: adminEnv(),
    });
    await new ListTeamMembersRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ members: [] }));

    const missing = createRouteContext({ url: 'https://example.com/user/admin/team/members', env: adminEnv() });
    await new ListTeamMembersRoute({} as never).handle(missing);
    expect(missing.json).toHaveBeenCalledWith(expect.objectContaining({ Exception: expect.objectContaining({ Type: 'BadRequest' }) }), 400);
  });

  it('PUT /user/admin/team/member/role updates roles', async () => {
    vi.mocked(TeamMembersDAO.prototype.updateMemberRole).mockResolvedValue(1);
    const c = createRouteContext({
      method: 'PUT',
      body: { teamId: 't1', userEmail: 'dev@example.com', role: 'admin' },
      env: adminEnv(),
    });
    await new UpdateTeamMemberRoleRoute({} as never).handle(c);
    expect(TeamMembersDAO.prototype.updateMemberRole).toHaveBeenCalledWith('t1', { userId: null, anchorEmail: 'dev@example.com' }, 'admin');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('team account routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /user/admin/team/account adds accounts', async () => {
    vi.mocked(TeamAccountsDAO.prototype.addAccountToTeam).mockResolvedValue(undefined);
    vi.mocked(AwsAccountsDAO.prototype.accountExists).mockResolvedValue(true);
    const c = createRouteContext({
      method: 'POST',
      body: { teamId: 't1', awsAccountId: '123456789012' },
      env: adminEnv(),
    });
    await new AddTeamAccountRoute({} as never).handle(c);
    expect(TeamAccountsDAO.prototype.addAccountToTeam).toHaveBeenCalledWith('t1', '123456789012');
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /user/admin/team/account removes accounts', async () => {
    vi.mocked(TeamAccountsDAO.prototype.removeAccountFromTeam).mockResolvedValue(undefined);
    const c = createRouteContext({
      method: 'DELETE',
      body: { teamId: 't1', awsAccountId: '123456789012' },
      env: adminEnv(),
    });
    await new RemoveTeamAccountRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('GET /user/admin/team/accounts lists account ids', async () => {
    vi.mocked(TeamAccountsDAO.prototype.getAccountsByTeam).mockResolvedValue(['123456789012']);
    const c = createRouteContext({
      url: 'https://example.com/user/admin/team/accounts?teamId=11111111-1111-4111-8111-111111111111',
      env: adminEnv(),
    });
    await new ListTeamAccountsRoute({} as never).handle(c);
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['123456789012'] }));
  });
});

/**
 * The member and account writes answer 404 and 409 rather than reporting a no-op
 * as success: a duplicate add, a role change for a non-member, a demotion that
 * would empty the admin set, and an account this deployment has never connected.
 *
 * Those statuses only exist in `TeamService`, so the published OpenAPI document
 * is the only place a caller learns they are possible — and `/docs` is data that
 * typechecks and builds whatever it says. This drives each failure and asserts the
 * route *declares* the status it actually produced.
 */
describe('member and account write statuses are declared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The status `c.json` was last called with, or undefined for a non-error answer.
   */
  function statusOf(c: ReturnType<typeof createRouteContext>): number | undefined {
    const mocked = c.json as unknown as { mock: { calls: unknown[][] } };
    const call = mocked.mock.calls.at(-1);
    return typeof call?.[1] === 'number' ? call[1] : undefined;
  }

  function declaredStatuses(route: { schema: { responses: Record<string, unknown> } }): string[] {
    return Object.keys(route.schema.responses);
  }

  it('a duplicate add answers 409 and the route declares it', async () => {
    vi.mocked(TeamMembersDAO.prototype.addMember).mockResolvedValue(0);
    const c = createRouteContext({
      method: 'POST',
      body: { teamId: 't1', userEmail: 'dev@example.com', role: 'member' },
      env: adminEnv(),
    });
    const route = new AddTeamMemberRoute({} as never);
    await route.handle(c);

    expect(statusOf(c)).toBe(409);
    expect(declaredStatuses(route)).toContain('409');
  });

  it('removing a non-member answers 404 and the route declares it', async () => {
    vi.mocked(TeamMembersDAO.prototype.getMemberRole).mockResolvedValue(null);
    const c = createRouteContext({
      method: 'DELETE',
      body: { teamId: 't1', userEmail: 'dev@example.com' },
      env: adminEnv(),
    });
    const route = new RemoveTeamMemberRoute({} as never);
    await route.handle(c);

    expect(statusOf(c)).toBe(404);
    expect(declaredStatuses(route)).toContain('404');
  });

  it('demoting the last admin answers 409 and the route declares it', async () => {
    vi.mocked(TeamMembersDAO.prototype.getMemberRole).mockResolvedValue('admin');
    vi.mocked(TeamMembersDAO.prototype.countAdmins).mockResolvedValue(1);
    const c = createRouteContext({
      method: 'PUT',
      body: { teamId: 't1', userEmail: 'dev@example.com', role: 'member' },
      env: adminEnv(),
    });
    const route = new UpdateTeamMemberRoleRoute({} as never);
    await route.handle(c);

    expect(statusOf(c)).toBe(409);
    expect(declaredStatuses(route)).toContain('409');
  });

  it('role-changing a non-member answers 404 and the route declares it', async () => {
    vi.mocked(TeamMembersDAO.prototype.getMemberRole).mockResolvedValue(null);
    const c = createRouteContext({
      method: 'PUT',
      body: { teamId: 't1', userEmail: 'dev@example.com', role: 'admin' },
      env: adminEnv(),
    });
    const route = new UpdateTeamMemberRoleRoute({} as never);
    await route.handle(c);

    expect(statusOf(c)).toBe(404);
    expect(declaredStatuses(route)).toContain('404');
  });

  it('adding an unconnected account answers 404 and the route declares it', async () => {
    vi.mocked(AwsAccountsDAO.prototype.accountExists).mockResolvedValue(false);
    const c = createRouteContext({
      method: 'POST',
      body: { teamId: 't1', awsAccountId: '123456789012' },
      env: adminEnv(),
    });
    const route = new AddTeamAccountRoute({} as never);
    await route.handle(c);

    expect(statusOf(c)).toBe(404);
    expect(declaredStatuses(route)).toContain('404');
  });
});
