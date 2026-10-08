import type { Team, TeamInternal } from '@aws-access-bridge/shared/model';
import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';
import { assertD1Success } from '@aws-access-bridge/backend-data/utils';
import { BaseDAO } from './BaseDAO';

class TeamsDAO extends BaseDAO {
  public async createTeam(teamName: string, createdBy: string): Promise<Team> {
    const teamId: string = UUIDUtil.getRandomUUID();
    const createdAt: number = TimestampUtil.getCurrentUnixTimestampInSeconds();
    // `teams.team_name` is UNIQUE, and D1 resolves a failed statement with
    // `{success: false}` rather than throwing. Without this check a duplicate name
    // returned 200 with a teamId that resolves to no row, and every later member
    // or account write targeted a team that does not exist.
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO teams (team_id, team_name, created_at, created_by) VALUES (?, ?, ?, ?)')
          .bind(teamId, teamName, createdAt, createdBy)
          .run(),
      'create team',
    );
    return { teamId, teamName, createdAt, createdBy };
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
    // Batched so the cascade is atomic: three separate autocommitted statements
    // could fail partway and leave a team with a partially destroyed member or
    // account set, while still reporting success (none checked `result.success`).
    // D1 rolls the whole batch back if any statement fails.
    const results: D1Result[] = await this.database.batch([
      this.database.prepare('DELETE FROM team_accounts WHERE team_id = ?').bind(teamId),
      this.database.prepare('DELETE FROM team_members WHERE team_id = ?').bind(teamId),
      this.database.prepare('DELETE FROM teams WHERE team_id = ?').bind(teamId),
    ]);
    for (const result of results) {
      assertD1Success(result, `delete team ${teamId}`);
    }
  }

  public async updateTeamName(teamId: string, newName: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE teams SET team_name = ? WHERE team_id = ?').bind(newName, teamId).run(),
      'rename team',
    );
  }
}

export { TeamsDAO };
