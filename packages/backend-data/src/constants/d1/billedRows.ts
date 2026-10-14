/**
 * What a write costs, in D1 rows.
 *
 * D1 bills a write as the table row **plus every index entry the write rewrote**,
 * so the multiplier is a property of the schema rather than of the layer doing
 * the writing. That is why `@rexezuge/d1` takes this as a **port**: the package
 * owns the accounting shape, and whoever owns the migrations owns the table.
 *
 * ### Why the figure here is a ceiling and not an expectation
 *
 * A statement only rewrites the indexes covering the columns it touches, so the
 * exact cost is `1 + indexes over the written columns`. That is not knowable from
 * the table alone — it needs the statement — and a figure derived by guessing
 * would be wrong in whichever direction the guess went.
 *
 * So this returns `1 + every index on the table`, which is the ceiling. It is
 * deliberately the pessimistic end, because the two errors are not symmetric: an
 * over-count wastes budget that was never spent, while an under-count lets an
 * invocation run until the platform terminates it with no error anywhere — the
 * rows are right, the suite is green, and the write is silently uncapped. A
 * budget built on the ceiling is a budget that holds.
 *
 * A table absent from `BILLED_INDEX_ENTRIES` returns `null`, which is **absent,
 * not zero** — the SDK types `billedRows` the same way on purpose, so a caller has
 * to notice that nothing is being accounted rather than reading a confident `0`.
 */
const BILLED_INDEX_ENTRIES: Readonly<Record<string, number>> = {
  assumable_roles: 4,
  audit_logs: 6,
  aws_accounts: 1,
  background_task_runs: 2,
  cost_data: 3,
  credential_cache_config: 2,
  credentials: 2,
  data_collection_config: 2,
  resource_inventory: 4,
  role_configs: 2,
  spend_alerts: 4,
  team_accounts: 2,
  team_members: 4,
  teams: 2,
  user_access_tokens: 5,
  user_emails: 2,
  user_favorite_accounts: 2,
  user_metadata: 3,
};

function billedRowsForTable(table: string, logicalRows: number): number | null {
  const multiplier = BILLED_INDEX_ENTRIES[table];
  return multiplier === undefined ? null : logicalRows * multiplier;
}

export { BILLED_INDEX_ENTRIES, billedRowsForTable };
