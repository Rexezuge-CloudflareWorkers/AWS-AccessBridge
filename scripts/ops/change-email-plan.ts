/**
 * The SQL sequence `scripts/ops/change-email.ts` applies.
 *
 * Pure and exported so the ordering and the interpolation guards are testable
 * without a database.
 */

/**
 * Single-quote a value for SQLite.
 *
 * The pattern allowlist is the safety property here: the caller interpolates
 * into SQL, so anything that is not a plain address or a plain id token is
 * refused rather than escaped-and-hoped. A bogus id simply matches no account.
 */
export function sqlEmail(value: string): string {
  // Character classes are written out rather than as \w / case-insensitive:
  // this allowlist is a security boundary, and it should read as exactly the
  // set of characters permitted in an address.
  // eslint-disable-next-line regexp/prefer-w, regexp/use-ignore-case
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error(`refusing to interpolate ${JSON.stringify(value)}: not a plain email address`);
  }
  return `'${value.toLowerCase()}'`;
}

/**
 * Single-quote a plain identifier token, refusing anything else.
 */
export function sqlToken(value: string, label: string): string {
  // eslint-disable-next-line regexp/prefer-w, regexp/use-ignore-case
  if (!/^[A-Za-z0-9_.@-]+$/.test(value)) {
    throw new Error(`refusing to interpolate ${JSON.stringify(value)}: not a plain ${label}`);
  }
  return `'${value}'`;
}

export interface AccountRow {
  id: string | null;
  anchor: string;
  current_email: string | null;
}

/**
 * One row of the `user_emails` takeover check.
 */
export interface RegistryHolder {
  user_id: string;
  is_verified: number;
  current_email: string | null;
}

/**
 * Looks the account up by id, or case-insensitively by its live or frozen
 * address.
 */
export function accountSelector(args: { account?: string; id?: string }): { sql: string; label: string } {
  if (args.id) {
    return { sql: `id = ${sqlToken(args.id, 'account id')}`, label: `id ${args.id}` };
  }
  return {
    sql: `lower(COALESCE(current_email, user_email)) = lower(${sqlEmail(args.account as string)})`,
    label: `account ${args.account}`,
  };
}

/**
 * Finds the account already holding `target` as a verified address.
 *
 * Compared case-insensitively because the registry key and the unique index on
 * `current_email` are both case-sensitive, so an exact-match check alone would
 * let two accounts differ only by case and both authenticate.
 */
export function takeoverCheck(target: string): string {
  return `SELECT ue.user_id, ue.is_verified, um.current_email
     FROM user_emails ue LEFT JOIN user_metadata um ON um.id = ue.user_id
     WHERE lower(ue.email) = lower(${target}) LIMIT 1`;
}

/**
 * Finds an account whose `current_email` is `target` and whose id is not ours.
 */
export function otherHolderCheck(target: string, accountId: string): string {
  return `SELECT id, current_email FROM user_metadata
     WHERE lower(current_email) = lower(${target}) AND id != ${accountId} LIMIT 1`;
}

/**
 * The claim → move → revoke statements, in that order.
 *
 * Claiming first is what keeps the user logged in throughout: there is only a
 * brief window where both addresses authenticate. Revoking first would open a
 * window where neither does. `user_metadata.user_email` is never touched — it is
 * the frozen anchor that `assumable_roles`, `user_favorite_accounts` and
 * `user_access_tokens` cascade from (the last with `ON DELETE CASCADE`), and D1
 * will not let those references be repointed.
 */
export function changeEmailStatements(target: string, accountId: string, now: number): string[] {
  return [
    `INSERT INTO user_emails (email, user_id, is_verified, created_at) VALUES (${target}, ${accountId}, 1, ${now}) ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, is_verified = excluded.is_verified;`,
    `UPDATE user_metadata SET current_email = ${target} WHERE id = ${accountId};`,
    `UPDATE user_emails SET is_verified = 0 WHERE user_id = ${accountId} AND email != ${target};`,
  ];
}

/**
 * Verifies the applied state, including the full address registry.
 */
export function verifyStatement(accountId: string): string {
  return `SELECT user_email AS anchor, current_email,
            (SELECT group_concat(email || ':' || is_verified, ' ') FROM user_emails WHERE user_id = user_metadata.id) AS registry
     FROM user_metadata WHERE id = ${accountId}`;
}

/**
 * True when this registry row means the address is a live login belonging to
 * another account.
 */
export function isTakenByAnotherAccount(holder: RegistryHolder | undefined, accountId: string): boolean {
  return holder !== undefined && holder.is_verified === 1 && holder.user_id !== accountId;
}
