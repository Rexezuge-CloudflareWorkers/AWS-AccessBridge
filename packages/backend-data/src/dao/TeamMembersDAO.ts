import type { TeamMember, TeamMemberInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';
import { ownerClause } from './AssumableRolesQueries';

import { assertD1Success } from '../utils/D1Utils';
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

  /**
   * Add a member, reporting whether the row was actually written.
   *
   * The count is the whole point: `INSERT OR IGNORE` makes a re-add — including
   * a re-add that was meant to promote the member — a silent success, so the
   * caller cannot tell "added" from "already there" unless the number comes
   * back. Zero changes is a conflict, not a no-op.
   */
  public async addMember(teamId: string, owner: TeamMemberOwner, role: string = 'member'): Promise<number> {
    const joinedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const result: D1Result = await this.database
      .prepare('INSERT OR IGNORE INTO team_members (team_id, user_email, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)')
      .bind(teamId, owner.anchorEmail, owner.userId, role, joinedAt)
      .run();
    assertD1Success(result, `add team member`);
    return result.meta?.changes ?? 0;
  }

  public async removeMember(teamId: string, owner: TeamMemberOwner): Promise<number> {
    const result: D1Result = await this.database
      .prepare(`DELETE FROM team_members WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')}`)
      .bind(teamId, owner.userId, owner.anchorEmail)
      .run();
    assertD1Success(result, `remove team member`);
    return result.meta?.changes ?? 0;
  }

  /**
   * How many admins a team has.
   *
   * Read before a demotion or a removal: the admin rows are the only handle on
   * who can still administer the team, so the last one cannot be taken away.
   */
  public async countAdmins(teamId: string): Promise<number> {
    const result = await this.database
      .prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ? AND role = ?')
      .bind(teamId, 'admin')
      .first<{ total: number }>();
    return result?.total ?? 0;
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

  public async updateMemberRole(teamId: string, owner: TeamMemberOwner, newRole: string): Promise<number> {
    const result: D1Result = await this.database
      .prepare(`UPDATE team_members SET role = ? WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')}`)
      .bind(newRole, teamId, owner.userId, owner.anchorEmail)
      .run();
    assertD1Success(result, `update team member role`);
    return result.meta?.changes ?? 0;
  }

  /**
  The member's current role, or null when they are not a member.
  */
  public async getMemberRole(teamId: string, owner: TeamMemberOwner): Promise<string | null> {
    const result = await this.database
      .prepare(`SELECT role FROM team_members WHERE team_id = ? AND ${TeamMembersDAO.ownerClause('team_members')} LIMIT 1`)
      .bind(teamId, owner.userId, owner.anchorEmail)
      .first<{ role: string }>();
    return result?.role ?? null;
  }
}

export { TeamMembersDAO };
export type { TeamMemberOwner };
