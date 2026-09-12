import { DatabaseError } from '@aws-access-bridge/backend-errors';

class AwsAccountsDAO {
  protected readonly database: D1Database | D1DatabaseSession;

  constructor(database: D1Database | D1DatabaseSession) {
    this.database = database;
  }

  public async ensureAccountExists(awsAccountId: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('INSERT OR IGNORE INTO aws_accounts (aws_account_id) VALUES (?)')
      .bind(awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to ensure account exists: ${result.error}`);
    }
  }

  public async setAccountNickname(awsAccountId: string, nickname: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE aws_accounts SET aws_account_nickname = ? WHERE aws_account_id = ?')
      .bind(nickname, awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to set account nickname: ${result.error}`);
    }
  }

  public async removeAccountNickname(awsAccountId: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare('UPDATE aws_accounts SET aws_account_nickname = NULL WHERE aws_account_id = ?')
      .bind(awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to remove account nickname: ${result.error}`);
    }
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.database
      .prepare('DELETE FROM aws_accounts WHERE aws_account_id NOT IN (SELECT DISTINCT aws_account_id FROM assumable_roles)')
      .run();
    return result.meta?.changes ?? 0;
  }
}

export { AwsAccountsDAO };
