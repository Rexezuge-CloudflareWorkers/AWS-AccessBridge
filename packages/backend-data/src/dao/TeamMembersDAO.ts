import { DatabaseError } from '@aws-access-bridge/backend-errors';
import type { TeamMember, TeamMemberInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';
import { ownerClause } from './AssumableRolesQueries';

/**
 * Who a user-keyed `team_members` statement is about.
 *
 * `userId` is the account id and `anchorEmail` its frozen anchor. Membership
 * keys on the id so it survives an address change; the anchor arm exists for
 * rows the 0032 backfill could not attribute.
 */
interface TeamMemberOwner {
  userId: string | null;
  anchorEmail: string;
}

class TeamMembersDAO extends BaseDAO {
  /**
   * The owner predicate, shared by every statement so the id-keyed and
   * address-keyed paths cannot drift. Delegates to `AssumableRolesQueries`
   * so this security-critical SQL has exactly one definition in the codebase.
   */
  private static ownerClause(alias: string): string {
    return ownerClause(alias);
  }

  public async addMember(teamId: string, owner: TeamMemberOwner, role: string = 'member'): Promise<void> {
    const joinedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare('INSERT OR IGNORE INTO team_members (team_id, user_email, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)')
      .bind(teamId, owner.anchorEmail, owner.userId, role, joinedAt)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to add team member: ${result.error}`);
    }
  }

  public async removeMember(teamId: string, owner: TeamMemberOwner): Promise<void> {
    const result: D1Result = await this.database
      .prepare(`DELETE FROM team_members WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')}`)
      .bind(teamId, owner.userId, owner.anchorEmail)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to remove team member: ${result.error}`);
    }
  }

  public async isTeamAdmin(teamId: string, owner: TeamMemberOwner): Promise<boolean> {
    const result = await this.database
      .prepare(`SELECT role FROM team_members WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')}`)
      .bind(teamId, owner.userId, owner.anchorEmail)
      .first<{ role: string }>();
    return result?.role === 'admin';
  }

  public async getTeamsByUserEmail(userEmail: string): Promise<Array<{ teamId: string; teamName: string; role: string }>> {
    const results = await this.database
      .prepare(
        'SELECT tm.team_id, t.team_name, tm.role FROM team_members tm JOIN teams t ON tm.team_id = t.team_id WHERE tm.user_email = ?',
      )
      .bind(userEmail)
      .all<{ team_id: string; team_name: string; role: string }>();
    return (results.results || []).map((r) => ({ teamId: r.team_id, teamName: r.team_name, role: r.role }));
  }

  public async getTeamsByUserId(owner: TeamMemberOwner): Promise<Array<{ teamId: string; teamName: string; role: string }>> {
    const results = await this.database
      .prepare(
        `SELECT tm.team_id, t.team_name, tm.role
         FROM team_members tm JOIN teams t ON tm.team_id = t.team_id
         WHERE ${TeamMembersDAO.ownerClause('tm')}`,
      )
      .bind(owner.userId, owner.anchorEmail)
      .all<{ team_id: string; team_name: string; role: string }>();
    return (results.results || []).map((r) => ({ teamId: r.team_id, teamName: r.team_name, role: r.role }));
  }

  /**
   * Members of a team, in role then address order.
   *
   * Ordered by `COALESCE(current_email, user_email)` rather than the raw
   * `user_email`: the frozen anchor would sort a renamed account under the name
   * it no longer uses, and admins read this list by address.
   */
  public async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    const results = await this.database
      .prepare(
        `SELECT tm.team_id AS team_id, tm.user_email AS user_email, tm.role AS role, tm.joined_at AS joined_at,
                COALESCE(um.current_email, tm.user_email) AS display_email
         FROM team_members tm
         LEFT JOIN user_metadata um ON um.id = tm.user_id
         WHERE tm.team_id = ?
         ORDER BY tm.role, display_email`,
      )
      .bind(teamId)
      .all<TeamMemberInternal & { display_email: string }>();
    return (results.results || []).map((r) => ({
      teamId: r.team_id,
      userEmail: r.display_email || r.user_email,
      role: r.role as 'admin' | 'member',
      joinedAt: r.joined_at,
    }));
  }

  public async updateMemberRole(teamId: string, owner: TeamMemberOwner, newRole: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(`UPDATE team_members SET role = ? WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')}`)
      .bind(newRole, teamId, owner.userId, owner.anchorEmail)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to update team member role: ${result.error}`);
    }
  }
}

export { TeamMembersDAO };
export type { TeamMemberOwner };
