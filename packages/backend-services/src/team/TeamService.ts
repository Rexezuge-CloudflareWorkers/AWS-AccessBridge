import { TeamAccountsDAO, TeamMembersDAO, TeamsDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { Team, TeamMember } from '@aws-access-bridge/shared/model';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000000';

interface TeamServiceEnv {
  AccessBridgeDB: D1Queryable;
}

class TeamService {
  constructor(private readonly env: TeamServiceEnv) {}

  public async createTeam(teamName: string, createdBy: string): Promise<Team> {
    if (!teamName?.trim()) throw new BadRequestError('Missing required field: teamName.');
    const teamsDAO: TeamsDAO = new TeamsDAO(this.env.AccessBridgeDB);
    return teamsDAO.createTeam(teamName.trim(), createdBy);
  }

  public async deleteTeam(teamId: string): Promise<void> {
    if (!teamId) throw new BadRequestError('Missing required field: teamId.');
    if (teamId === DEFAULT_TEAM_ID) throw new BadRequestError('Cannot delete the default team.');
    await new TeamsDAO(this.env.AccessBridgeDB).deleteTeam(teamId);
  }

  public async listTeams(): Promise<Team[]> {
    return new TeamsDAO(this.env.AccessBridgeDB).listTeams();
  }

  public async updateTeamName(teamId: string, teamName: string): Promise<void> {
    if (!teamId || !teamName?.trim()) throw new BadRequestError('Missing required fields.');
    await new TeamsDAO(this.env.AccessBridgeDB).updateTeamName(teamId, teamName.trim());
  }

  public async addMember(teamId: string, userEmail: string, role: string = 'member'): Promise<void> {
    if (!teamId || !userEmail) throw new BadRequestError('Missing required fields.');
    await new TeamMembersDAO(this.env.AccessBridgeDB).addMember(teamId, userEmail, role);
  }

  public async removeMember(teamId: string, userEmail: string): Promise<void> {
    if (!teamId || !userEmail) throw new BadRequestError('Missing required fields.');
    await new TeamMembersDAO(this.env.AccessBridgeDB).removeMember(teamId, userEmail);
  }

  public async listMembers(teamId: string): Promise<TeamMember[]> {
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    return new TeamMembersDAO(this.env.AccessBridgeDB).getMembersByTeam(teamId);
  }

  public async updateMemberRole(teamId: string, userEmail: string, role: string): Promise<void> {
    if (!teamId || !userEmail || !role) throw new BadRequestError('Missing required fields.');
    await new TeamMembersDAO(this.env.AccessBridgeDB).updateMemberRole(teamId, userEmail, role);
  }

  public async addAccount(teamId: string, awsAccountId: string): Promise<void> {
    if (!teamId || !awsAccountId) throw new BadRequestError('Missing required fields.');
    await new TeamAccountsDAO(this.env.AccessBridgeDB).addAccountToTeam(teamId, awsAccountId);
  }

  public async removeAccount(teamId: string, awsAccountId: string): Promise<void> {
    if (!teamId || !awsAccountId) throw new BadRequestError('Missing required fields.');
    await new TeamAccountsDAO(this.env.AccessBridgeDB).removeAccountFromTeam(teamId, awsAccountId);
  }

  public async listAccounts(teamId: string): Promise<string[]> {
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    return new TeamAccountsDAO(this.env.AccessBridgeDB).getAccountsByTeam(teamId);
  }
}

class TeamServiceFactory {
  public static create(env: TeamServiceEnv): TeamService {
    return new TeamService(env);
  }
}

export { DEFAULT_TEAM_ID, TeamService, TeamServiceFactory };
export type { TeamServiceEnv };
