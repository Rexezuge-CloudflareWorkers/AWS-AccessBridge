class TeamAccountsDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  public async addAccountToTeam(teamId: string, awsAccountId: string): Promise<void> {
    await this.database
      .prepare('INSERT OR IGNORE INTO team_accounts (team_id, aws_account_id) VALUES (?, ?)')
      .bind(teamId, awsAccountId)
      .run();
  }

  public async removeAccountFromTeam(teamId: string, awsAccountId: string): Promise<void> {
    await this.database.prepare('DELETE FROM team_accounts WHERE team_id = ? AND aws_account_id = ?').bind(teamId, awsAccountId).run();
  }

  public async getAccountsByTeam(teamId: string): Promise<string[]> {
    const results = await this.database
      .prepare('SELECT aws_account_id FROM team_accounts WHERE team_id = ?')
      .bind(teamId)
      .all<{ aws_account_id: string }>();
    return (results.results || []).map((r) => r.aws_account_id);
  }

  public async isAccountInTeam(teamId: string, awsAccountId: string): Promise<boolean> {
    const result = await this.database
      .prepare('SELECT 1 FROM team_accounts WHERE team_id = ? AND aws_account_id = ?')
      .bind(teamId, awsAccountId)
      .first();
    return !!result;
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM team_accounts WHERE aws_account_id NOT IN (SELECT DISTINCT aws_account_id FROM assumable_roles)')
      .run();
    return result.meta?.changes ?? 0;
  }
}

export { TeamAccountsDAO };
