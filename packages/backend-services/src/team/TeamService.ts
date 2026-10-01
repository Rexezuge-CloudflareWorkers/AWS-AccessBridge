import { TeamAccountsDAO, TeamMembersDAO, TeamsDAO } from '@aws-access-bridge/backend-data/dao';
import type { TeamMemberOwner } from '@aws-access-bridge/backend-data/dao';

import type { Team, TeamMember } from '@aws-access-bridge/shared/model';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000000';

type TeamServiceEnv = ServiceEnv;

class TeamService {
  private readonly identity: UserIdentityService;

  constructor(
    private readonly env: TeamServiceEnv,
    identity?: UserIdentityService,
  ) {
    this.identity = identity ?? new UserIdentityService(env);
  }

  private ownerFor(userEmail: string): Promise<TeamMemberOwner> {
    return resolveOwner(this.identity, userEmail);
  }

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
    const owner = await this.ownerFor(userEmail);
    await new TeamMembersDAO(this.env.AccessBridgeDB).addMember(teamId, owner, role);
  }

  public async removeMember(teamId: string, userEmail: string): Promise<void> {
    if (!teamId || !userEmail) throw new BadRequestError('Missing required fields.');
    const owner = await this.ownerFor(userEmail);
    await new TeamMembersDAO(this.env.AccessBridgeDB).removeMember(teamId, owner);
  }

  public async listMembers(teamId: string): Promise<TeamMember[]> {
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    return new TeamMembersDAO(this.env.AccessBridgeDB).getMembersByTeam(teamId);
  }

  public async updateMemberRole(teamId: string, userEmail: string, role: string): Promise<void> {
    if (!teamId || !userEmail || !role) throw new BadRequestError('Missing required fields.');
    const owner = await this.ownerFor(userEmail);
    await new TeamMembersDAO(this.env.AccessBridgeDB).updateMemberRole(teamId, owner, role);
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
}export { DEFAULT_TEAM_ID, TeamService };
export type { TeamServiceEnv };
