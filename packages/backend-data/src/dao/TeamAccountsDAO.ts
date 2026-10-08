import { BaseDAO } from './BaseDAO';
import { ORPHANED_BY_ASSUMABLE_ROLES } from './AwsAccountsDAO';

class TeamAccountsDAO extends BaseDAO {
  public async addAccountToTeam(teamId: string, awsAccountId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT OR IGNORE INTO team_accounts (team_id, aws_account_id) VALUES (?, ?)')
          .bind(teamId, awsAccountId)
          .run(),
      'add account to team',
    );
  }

  public async removeAccountFromTeam(teamId: string, awsAccountId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM team_accounts WHERE team_id = ? AND aws_account_id = ?').bind(teamId, awsAccountId).run(),
      'remove account from team',
    );
  }

  public async getAccountsByTeam(teamId: string): Promise<string[]> {
    const results = await this.database
      .prepare('SELECT aws_account_id FROM team_accounts WHERE team_id = ?')
      .bind(teamId)
      .all<{ aws_account_id: string }>();
    return (results.results || []).map((r) => r.aws_account_id);
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('team_accounts', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }
}

export { TeamAccountsDAO };
