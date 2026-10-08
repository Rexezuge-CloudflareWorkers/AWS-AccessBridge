import { BaseDAO } from './BaseDAO';

class AwsAccountsDAO extends BaseDAO {
  public async ensureAccountExists(awsAccountId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('INSERT OR IGNORE INTO aws_accounts (aws_account_id) VALUES (?)').bind(awsAccountId).run(),
      'ensure account exists',
    );
  }

  /**
   * Whether the account is already connected.
   *
   * A separate read from `ensureAccountExists` on purpose: that one *creates* the
   * row, and a caller that only wants to validate an id — adding an account to a
   * team — must not connect an account as a side effect of a typo.
   */
  public async accountExists(awsAccountId: string): Promise<boolean> {
    const result = await this.database
      .prepare('SELECT 1 AS present FROM aws_accounts WHERE aws_account_id = ? LIMIT 1')
      .bind(awsAccountId)
      .first<{ present: number }>();
    return result !== null;
  }

  public async setAccountNickname(awsAccountId: string, nickname: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE aws_accounts SET aws_account_nickname = ? WHERE aws_account_id = ?')
          .bind(nickname, awsAccountId)
          .run(),
      'set account nickname',
    );
  }

  public async removeAccountNickname(awsAccountId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE aws_accounts SET aws_account_nickname = NULL WHERE aws_account_id = ?').bind(awsAccountId).run(),
      'remove account nickname',
    );
  }

  public async deleteOrphaned(): Promise<number> {
    const result: D1Result = await this.deleteOrphanedRows('aws_accounts', ORPHANED_BY_ASSUMABLE_ROLES);
    return result.meta?.changes ?? 0;
  }
}

/**
 * Rows for an AWS account nobody can reach any more. Every `*_data`/config table
 * keyed on `aws_account_id` shares this shape — the account is orphaned once no
 * `assumable_roles` row names it — which is why the predicate lives here rather
 * than being retyped in six DAOs.
 */
const ORPHANED_BY_ASSUMABLE_ROLES: string = 'aws_account_id NOT IN (SELECT DISTINCT aws_account_id FROM assumable_roles)';

export { AwsAccountsDAO, ORPHANED_BY_ASSUMABLE_ROLES };
