'use client';

import { grantAccess, storeCredentialRelationship } from '../services/adminService';
import type { DiscoveredRole } from './onboardingWizard';

/**
 * The wizard's two batch operations.
 *
 * Both loop over a set and count failures rather than aborting on the first one,
 * which is the interesting behaviour and was unreachable while inline in a
 * 324-line hook. `settleAll` is the shared shape: run every item, tally the
 * failures, and let the caller decide what a non-zero count means.
 */

/**
 * Runs `action` for every item, counting rejections instead of stopping at the
 * first.
 *
 * Sequential rather than `Promise.allSettled` on purpose: these are AWS-backed
 * writes, and firing an unbounded fan-out of them concurrently would be a
 * self-inflicted throttle problem. One failure must not abandon the rest —
 * otherwise a single bad ARN would leave the remaining roles unwritten with no
 * indication of which ones.
 *
 * @returns how many items rejected.
 */
async function settleAll<T>(items: Iterable<T>, action: (item: T) => Promise<unknown>): Promise<number> {
  let failures = 0;
  for (const item of items) {
    try {
      await action(item);
    } catch {
      failures += 1;
    }
  }
  return failures;
}

/**
 * Persists a credential relationship for each selected role.
 *
 * Roles with no discovered ARN — a manually added one, or a discovery that did
 * not return it — are skipped rather than attempted: there is no ARN to store
 * against, and a call with an empty ARN would create a relationship row that
 * resolves to nothing.
 *
 * @returns whether every attempted relationship saved. The wizard uses this to
 * decide whether it may advance to the next step, so a partial failure must
 * return false.
 */
async function saveRoleRelationships(
  selectedRoles: Set<string>,
  discoveredRoles: DiscoveredRole[],
  assumedByArn: string,
): Promise<{ ok: boolean; attempted: number; failures: number }> {
  const withArn = [...selectedRoles]
    .map((roleName) => discoveredRoles.find((role) => role.roleName === roleName))
    .filter((role): role is DiscoveredRole => Boolean(role?.arn));

  if (withArn.length === 0) {
    return { ok: true, attempted: 0, failures: 0 };
  }

  const failures = await settleAll(withArn, (role) => storeCredentialRelationship(role.arn, assumedByArn));
  return { ok: failures === 0, attempted: withArn.length, failures };
}

/**
 * Grants every selected role to every listed address.
 *
 * An empty `userEmail` entry is dropped rather than sent: the route falls back to
 * the authenticated admin only when the field is absent, so a blank string would
 * be treated as a real invalid address.
 *
 * @returns how many grants rejected, out of `emails.length * roles.length`.
 */
async function grantSelectedRoles(
  emails: string[],
  roles: Set<string>,
  awsAccountId: string,
): Promise<{ attempted: number; failures: number }> {
  const pairs: Array<{ email: string; role: string }> = [];
  for (const email of emails) {
    const trimmed = email.trim();
    if (!trimmed) continue;
    for (const role of roles) {
      pairs.push({ email: trimmed, role });
    }
  }

  if (pairs.length === 0) {
    return { attempted: 0, failures: 0 };
  }

  const failures = await settleAll(pairs, (pair) => grantAccess(pair.email, awsAccountId, pair.role));
  return { attempted: pairs.length, failures };
}

export { grantSelectedRoles, saveRoleRelationships, settleAll };
