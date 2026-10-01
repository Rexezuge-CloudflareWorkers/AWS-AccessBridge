import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { ownerClause } from './AssumableRolesQueries';
import { BaseDAO } from './BaseDAO';

class UserFavoriteAccountsDAO extends BaseDAO {
  /**
   * Mark an account favourited.
   *
   * `INSERT OR IGNORE` deduplicates on BOTH the pre-0032
   * `(user_email, aws_account_id)` primary key and the 0032
   * `(user_id, aws_account_id)` unique index, so a re-favourite after an address
   * change is still a no-op rather than a duplicate row. `user_email` keeps the
   * anchor, because that column is the foreign key the schema cannot repoint.
   */
  public async favoriteAccount(anchorEmail: string, awsAccountId: string, userId: string | null = null): Promise<void> {
    const result: D1Result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO user_favorite_accounts (user_email, user_id, aws_account_id)
         VALUES (?, ?, ?)`,
      )
      .bind(anchorEmail, userId, awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to favorite account: ${result.error}`);
    }
  }

  public async unfavoriteAccount(userEmail: string, awsAccountId: string, userId: string | null = null): Promise<void> {
    const { clause, bindings } = UserFavoriteAccountsDAO.ownerPredicate(userId, userEmail);
    const result: D1Result = await this.database
      .prepare(`DELETE FROM user_favorite_accounts WHERE ${clause} AND aws_account_id = ?`)
      .bind(...bindings, awsAccountId)
      .run();
    if (!result.success) {
      throw new DatabaseError(`Failed to unfavorite account: ${result.error}`);
    }
  }

  /**
   * Favourites for an account id.
   *
   * The `user_id IS NULL` arm is what keeps a favourite saved before 0032 — or
   * one the backfill could not attribute — visible to its owner, and matching
   * on the id is what makes it survive an address change at all.
   */
  public async getByUserId(userId: string, anchorEmail: string): Promise<Array<{ awsAccountId: string; nickname?: string }>> {
    return this.runListQuery(
      `SELECT ufa.aws_account_id, aa.aws_account_nickname
       FROM user_favorite_accounts ufa
       LEFT JOIN aws_accounts aa ON ufa.aws_account_id = aa.aws_account_id
       WHERE ${ownerClause('ufa')}`,
      [userId, anchorEmail],
    );
  }

  private async runListQuery(sql: string, bindings: unknown[]): Promise<Array<{ awsAccountId: string; nickname?: string }>> {
    const results = await this.database
      .prepare(sql)
      .bind(...bindings)
      .all<{ aws_account_id: string; aws_account_nickname: string | null }>();
    if (!results || !results.results) {
      return [];
    }
    return results.results.map((row) => ({
      awsAccountId: row.aws_account_id,
      nickname: row.aws_account_nickname || undefined,
    }));
  }

  /**
   * The owner predicate for writes, shared by the id-keyed and address-keyed
   * paths so the two cannot drift.
   *
   * When no id was resolved the address arm is used *on its own*, and only over
   * rows with `user_id IS NULL`. That guard is what stops an address one account
   * has moved away from — but which still sits in that account's legacy column —
   * from matching a different account's rows.
   */
  private static ownerPredicate(userId: string | null, userEmail: string): { clause: string; bindings: unknown[] } {
    // Null id narrows to the address arm on its own; a resolved id gets the shared
    // two-arm predicate. Both delegate to `ownerClause` so the `user_id IS NULL`
    // guard — the part that stops a moved-off address matching another account's
    // row — has a single definition.
    return userId === null
      ? { clause: 'user_favorite_accounts.user_id IS NULL AND user_favorite_accounts.user_email = ?', bindings: [userEmail] }
      : { clause: ownerClause('user_favorite_accounts'), bindings: [userId, userEmail] };
  }
}

export { UserFavoriteAccountsDAO };
