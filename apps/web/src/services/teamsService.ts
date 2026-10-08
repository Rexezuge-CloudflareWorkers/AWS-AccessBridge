import type { Team, TeamMember } from '@aws-access-bridge/shared';
import { apiRequest } from '../lib/api';

/**
 * `Team` and `TeamMember` are the shared model types, not local look-alikes. This
 * file used to redeclare both with `role: string`, which widened the shared
 * `'admin' | 'member'` to anything and meant a role the server would reject
 * typechecked fine.
 */
type TeamRole = TeamMember['role'];

async function listTeams(): Promise<Team[]> {
  const data = await apiRequest<{ teams: Team[] }>('/user/admin/teams', { method: 'GET' });
  return data.teams ?? [];
}

async function createTeam(teamName: string): Promise<Team> {
  const data = await apiRequest<{ team: Team }>('/user/admin/team', { method: 'POST', body: { teamName } });
  return data.team;
}

async function deleteTeam(teamId: string): Promise<void> {
  await apiRequest<void>('/user/admin/team', { method: 'DELETE', body: { teamId } });
}

async function renameTeam(teamId: string, teamName: string): Promise<void> {
  await apiRequest<void>('/user/admin/team/name', { method: 'PUT', body: { teamId, teamName } });
}

async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const data = await apiRequest<{ members: TeamMember[] }>(`/user/admin/team/members?teamId=${encodeURIComponent(teamId)}`, {
    method: 'GET',
  });
  return data.members ?? [];
}

async function addTeamMember(teamId: string, userEmail: string, role: TeamRole): Promise<void> {
  await apiRequest<void>('/user/admin/team/member', { method: 'POST', body: { teamId, userEmail, role } });
}

async function removeTeamMember(teamId: string, userEmail: string): Promise<void> {
  await apiRequest<void>('/user/admin/team/member', { method: 'DELETE', body: { teamId, userEmail } });
}

async function updateTeamMemberRole(teamId: string, userEmail: string, role: TeamRole): Promise<void> {
  await apiRequest<void>('/user/admin/team/member/role', { method: 'PUT', body: { teamId, userEmail, role } });
}

async function listTeamAccounts(teamId: string): Promise<string[]> {
  const data = await apiRequest<{ accountIds: string[] }>(`/user/admin/team/accounts?teamId=${encodeURIComponent(teamId)}`, {
    method: 'GET',
  });
  return data.accountIds ?? [];
}

async function addTeamAccount(teamId: string, awsAccountId: string): Promise<void> {
  await apiRequest<void>('/user/admin/team/account', { method: 'POST', body: { teamId, awsAccountId } });
}

async function removeTeamAccount(teamId: string, awsAccountId: string): Promise<void> {
  await apiRequest<void>('/user/admin/team/account', { method: 'DELETE', body: { teamId, awsAccountId } });
}

export type { TeamRole };
export {
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
};

export { type Team, type TeamMember } from '@aws-access-bridge/shared';
