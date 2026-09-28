/**
 * Shared SQL fragments + row-mapping for `AssumableRolesDAO`.
 * Previously `getAllRolesByUserEmail` vs `searchAccountsByQuery` duplicated
 * ~18 lines of identical `roleMap` build + near-identical FROM/JOIN SQL
 * (only the LIKE clause differed). Extracted before it hits 500+ lines
 * (Otter `ConnectedApplicationMetadataMapper` precedent).
 *
 * Migration 0032 note: the two identity placeholders below are independent, and
 * callers bind them in this order.
 *
 *   1. the favourite-account join owner,
 *   2. the role owner in the WHERE clause.
 *
 * They used to be the same value bound twice, from a single `userEmail`. They
 * are now the account id and its anchor, which differ the moment an account
 * changes address, and keeping them as two placeholders is what lets the
 * favourites join keep working across that change.
 */

/**
 * The owner predicate for a user-keyed query.
 *
 * `id OR (id IS NULL AND address)` is deliberate on both arms. The id arm matches
 * every row the backfill attributed, regardless of which address was current at
 * write time, so a grant survives an address change. The `id IS NULL` arm keeps
 * rows the backfill could not attribute — an unknown or deleted actor, or one of
 * the ambiguous mixed-case accounts 0032 leaves unresolved — visible instead of
 * silently dropping them. Without the `IS NULL` guard the address arm would
 * double-count a row the id arm already matched.
 */
function ownerClause(alias: string): string {
  return `(${alias}.user_id = ? OR (${alias}.user_id IS NULL AND ${alias}.user_email = ?))`;
}

const ASSUMABLE_ROLES_FROM_JOIN = `FROM assumable_roles ar
          LEFT JOIN aws_accounts aa ON ar.aws_account_id = aa.aws_account_id
          LEFT JOIN user_favorite_accounts ufa ON ar.aws_account_id = ufa.aws_account_id AND ${ownerClause('ufa')}`;

const ASSUMABLE_ROLES_ORDER_BY = `ORDER BY is_favorite DESC,
                   CASE WHEN aa.aws_account_nickname IS NOT NULL THEN 0 ELSE 1 END,
                   COALESCE(aa.aws_account_nickname, ar.aws_account_id)`;

const ASSUMABLE_ROLES_SELECT = `SELECT ar.aws_account_id, ar.role_name, ar.hidden, aa.aws_account_nickname,
                CASE WHEN ufa.aws_account_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite`;

function hiddenFilterClause(showHidden: boolean): string {
  return showHidden ? '' : 'AND (ar.hidden IS NULL OR ar.hidden = FALSE)';
}

function buildListRolesQuery(showHidden: boolean): string {
  const hiddenFilter: string = hiddenFilterClause(showHidden);
  return `${ASSUMABLE_ROLES_SELECT}
          ${ASSUMABLE_ROLES_FROM_JOIN}
          WHERE ${ownerClause('ar')} ${hiddenFilter}
          ${ASSUMABLE_ROLES_ORDER_BY}
          LIMIT ? OFFSET ?`;
}

function buildSearchRolesQuery(showHidden: boolean): string {
  const hiddenFilter: string = hiddenFilterClause(showHidden);
  return `${ASSUMABLE_ROLES_SELECT}
          ${ASSUMABLE_ROLES_FROM_JOIN}
          WHERE ${ownerClause('ar')} ${hiddenFilter}
            AND (ar.aws_account_id LIKE ? OR aa.aws_account_nickname LIKE ?)
          ${ASSUMABLE_ROLES_ORDER_BY}`;
}

export {
  ASSUMABLE_ROLES_FROM_JOIN,
  ASSUMABLE_ROLES_ORDER_BY,
  ASSUMABLE_ROLES_SELECT,
  buildListRolesQuery,
  buildSearchRolesQuery,
  hiddenFilterClause,
  ownerClause,
};
