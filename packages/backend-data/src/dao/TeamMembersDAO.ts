import type { TeamMember, TeamMemberInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

class TeamMembersDAO extends BaseDAO {
  public async addMember(teamId: string, userEmail: string, role: string = 'member'): Promise<void> {
    const joinedAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await this.database
      .prepare('INSERT OR IGNORE INTO team_members (team_id, user_email, role, joined_at) VALUES (?, ?, ?, ?)')
      .bind(teamId, userEmail, role, joinedAt)
      .run();
  }

  public async removeMember(teamId: string, userEmail: string): Promise<void> {
    await this.database.prepare('DELETE FROM team_members WHERE team_id = ? AND user_email = ?').bind(teamId, userEmail).run();
  }

  public async isTeamAdmin(teamId: string, userEmail: string): Promise<boolean> {
    const result = await this.database
      .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_email = ?')
      .bind(teamId, userEmail)
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

  public async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    const results = await this.database
      .prepare('SELECT * FROM team_members WHERE team_id = ? ORDER BY role, user_email')
      .bind(teamId)
      .all<TeamMemberInternal>();
    return (results.results || []).map((r) => ({
      teamId: r.team_id,
      userEmail: r.user_email,
      role: r.role as 'admin' | 'member',
      joinedAt: r.joined_at,
    }));
  }

  public async updateMemberRole(teamId: string, userEmail: string, newRole: string): Promise<void> {
    await this.database
      .prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_email = ?')
      .bind(newRole, teamId, userEmail)
      .run();
  }
}

export { TeamMembersDAO };
