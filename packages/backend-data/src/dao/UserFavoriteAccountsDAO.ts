import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { BaseDAO } from './BaseDAO';

class UserFavoriteAccountsDAO extends BaseDAO {
  public async favoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO user_favorite_accounts (user_email, aws_account_id)
         VALUES (?, ?)`,
      )
      .bind(userEmail, awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to favorite account: ${result.error}`);
    }
  }

  public async unfavoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `DELETE FROM user_favorite_accounts
         WHERE user_email = ? AND aws_account_id = ?`,
      )
      .bind(userEmail, awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to unfavorite account: ${result.error}`);
    }
  }

  public async getFavoriteAccounts(userEmail: string): Promise<Array<{ awsAccountId: string; nickname?: string }>> {
    const results = await this.database
      .prepare(
        `SELECT ufa.aws_account_id, aa.aws_account_nickname
         FROM user_favorite_accounts ufa
         LEFT JOIN aws_accounts aa ON ufa.aws_account_id = aa.aws_account_id
         WHERE ufa.user_email = ?`,
      )
      .bind(userEmail)
      .all<{ aws_account_id: string; aws_account_nickname: string | null }>();
    if (!results || !results.results) {
      return [];
    }
    return results.results.map((row) => ({
      awsAccountId: row.aws_account_id,
      nickname: row.aws_account_nickname || undefined,
    }));
  }
}

export { UserFavoriteAccountsDAO };
