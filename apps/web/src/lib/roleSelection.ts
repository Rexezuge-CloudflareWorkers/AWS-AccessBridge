/**
 * Defaults each account's selected role to its first available one, without
 * disturbing a choice the user already made.
 *
 * An account is (re)defaulted only when it has roles and its current selection is
 * missing or no longer among them — a page change can drop the role the user
 * picked. Accounts with no roles are left alone, so there is never a selection
 * pointing at nothing.
 *
 * Returns `previous` itself when nothing needed defaulting, so the caller's
 * `setState` bails out and a fetch that changes nothing costs no extra render.
 */
function defaultRoleSelection(previous: Record<string, string>, rolesByAccount: Record<string, string[]>): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const [accountId, roles] of Object.entries(rolesByAccount)) {
    const current: string = (next ?? previous)[accountId];
    // `includes` on the roles is the whole test: an absent key answers `undefined`
    // to `includes`, which is `false` — so "no selection" and "a selection that is
    // no longer offered" fall out of one check instead of a null comparison.
    if (roles.length === 0 || roles.includes(current)) {
      continue;
    }
    next ??= { ...previous };
    next[accountId] = roles[0];
  }
  return next ?? previous;
}

export { defaultRoleSelection };
