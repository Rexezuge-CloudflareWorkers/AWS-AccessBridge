import { TeamAccountsDAO, TeamMembersDAO, TeamsDAO } from '@aws-access-bridge/backend-data/dao';
import type { TeamMemberOwner } from '@aws-access-bridge/backend-data/dao';
import { AwsAccountsDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';

import type { Team, TeamMember } from '@aws-access-bridge/shared/model';
import { BadRequestError, ConflictError, NotFoundError } from '@aws-access-bridge/backend-errors';
import { DEFAULT_TEAM_ID } from '@aws-access-bridge/shared/constants';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

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

  /**
   * Add a member.
   *
   * `INSERT OR IGNORE` reports zero changes for an existing member, so the
   * duplicate is answered 409 rather than as a success — silently ignoring a
   * promotion to admin left the caller believing it had happened.
   */
  public async addMember(teamId: string, userEmail: string, role: string = 'member'): Promise<void> {
    if (!teamId || !userEmail) throw new BadRequestError('Missing required fields.');
    const owner = await this.ownerFor(userEmail);
    // Provision first: `team_members.user_email` is a foreign key onto
    // `user_metadata`, and an admin routinely adds someone who has not signed
    // in yet.
    await new UserMetadataDAO(this.env.AccessBridgeDB).ensureUserEmailExists(owner.anchorEmail);
    const added: number = await new TeamMembersDAO(this.env.AccessBridgeDB).addMember(teamId, owner, role);
    if (added === 0) {
      throw new ConflictError('That user is already a member of this team.');
    }
  }

  public async removeMember(teamId: string, userEmail: string): Promise<void> {
    if (!teamId || !userEmail) throw new BadRequestError('Missing required fields.');
    const owner = await this.ownerFor(userEmail);
    const membersDAO = new TeamMembersDAO(this.env.AccessBridgeDB);
    const currentRole: string | null = await membersDAO.getMemberRole(teamId, owner);
    if (currentRole === null) {
      throw new NotFoundError('That user is not a member of this team.');
    }
    await this.assertNotTheLastAdmin(teamId, membersDAO, owner);
    const removed: number = await membersDAO.removeMember(teamId, owner);
    if (removed === 0) {
      throw new NotFoundError('That user is not a member of this team.');
    }
  }

  public async listMembers(teamId: string): Promise<TeamMember[]> {
    if (!teamId) throw new BadRequestError('Missing required parameter: teamId.');
    return new TeamMembersDAO(this.env.AccessBridgeDB).getMembersByTeam(teamId);
  }

  public async updateMemberRole(teamId: string, userEmail: string, role: string): Promise<void> {
    if (!teamId || !userEmail || !role) throw new BadRequestError('Missing required fields.');
    const owner = await this.ownerFor(userEmail);
    const membersDAO = new TeamMembersDAO(this.env.AccessBridgeDB);
    const currentRole: string | null = await membersDAO.getMemberRole(teamId, owner);
    if (currentRole === null) {
      throw new NotFoundError('That user is not a member of this team.');
    }
    if (currentRole === 'admin' && role !== 'admin') {
      await this.assertNotTheLastAdmin(teamId, membersDAO, owner);
    }
    const changed: number = await membersDAO.updateMemberRole(teamId, owner, role);
    if (changed === 0) {
      throw new NotFoundError('That user is not a member of this team.');
    }
  }

  public async addAccount(teamId: string, awsAccountId: string): Promise<void> {
    if (!teamId || !awsAccountId) throw new BadRequestError('Missing required fields.');
    const accountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    if (!(await accountsDAO.accountExists(awsAccountId))) {
      throw new NotFoundError('That AWS account is not connected to this deployment.');
    }
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

  /**
   * The last admin cannot be demoted or removed: the team would be left with
   * nobody able to administer it, and every membership write goes through a
   * superadmin, so recovery would mean a migration or a database edit.
   */
  private async assertNotTheLastAdmin(teamId: string, membersDAO: TeamMembersDAO, owner: TeamMemberOwner): Promise<void> {
    if ((await membersDAO.getMemberRole(teamId, owner)) !== 'admin') return;
    if ((await membersDAO.countAdmins(teamId)) <= 1) {
      throw new ConflictError('A team must keep at least one admin.');
    }
  }
}
export { DEFAULT_TEAM_ID } from '@aws-access-bridge/shared/constants';
export { TeamService };
export type { TeamServiceEnv };
