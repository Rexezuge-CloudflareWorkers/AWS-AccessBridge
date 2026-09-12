import type { Team, TeamInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import { BaseDAO } from './BaseDAO';

class TeamsDAO extends BaseDAO {
  public async createTeam(teamName: string, createdBy: string): Promise<Team> {
    const teamId: string = UUIDUtil.getRandomUUID();
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await this.database
      .prepare('INSERT INTO teams (team_id, team_name, created_at, created_by) VALUES (?, ?, ?, ?)')
      .bind(teamId, teamName, createdAt, createdBy)
      .run();
    return { teamId, teamName, createdAt, createdBy };
  }

  public async getTeamById(teamId: string): Promise<Team | null> {
    const result = await this.database.prepare('SELECT * FROM teams WHERE team_id = ?').bind(teamId).first<TeamInternal>();
    if (!result) return null;
    return { teamId: result.team_id, teamName: result.team_name, createdAt: result.created_at, createdBy: result.created_by };
  }

  public async listTeams(): Promise<Team[]> {
    const results = await this.database.prepare('SELECT * FROM teams ORDER BY team_name').all<TeamInternal>();
    return (results.results || []).map((r) => ({
      teamId: r.team_id,
      teamName: r.team_name,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
  }

  public async deleteTeam(teamId: string): Promise<void> {
    await this.database.prepare('DELETE FROM team_accounts WHERE team_id = ?').bind(teamId).run();
    await this.database.prepare('DELETE FROM team_members WHERE team_id = ?').bind(teamId).run();
    await this.database.prepare('DELETE FROM teams WHERE team_id = ?').bind(teamId).run();
  }

  public async updateTeamName(teamId: string, newName: string): Promise<void> {
    await this.database.prepare('UPDATE teams SET team_name = ? WHERE team_id = ?').bind(newName, teamId).run();
  }
}

export { TeamsDAO };
