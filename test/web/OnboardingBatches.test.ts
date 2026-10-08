import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantSelectedRoles, saveRoleRelationships, settleAll } from '@aws-access-bridge/web/lib/onboardingBatches';
import * as adminService from '@aws-access-bridge/web/services/adminService';
import type { DiscoveredRole } from '@aws-access-bridge/web/lib/onboardingWizard';

vi.mock('@aws-access-bridge/web/services/adminService');

const mocked = vi.mocked(adminService);

/**
 * The onboarding wizard's two batch operations.
 *
 * Both loop over a set and *count* failures rather than aborting on the first,
 * which is the behaviour worth pinning: a single bad ARN must not abandon the
 * remaining writes, and the wizard's step advance is gated on the count, so a
 * partial failure has to be distinguishable from a complete one.
 */
describe('settleAll', () => {
  it('runs every item and reports no failures', async () => {
    const seen: number[] = [];
    expect(
      await settleAll([1, 2, 3], async (n) => {
        seen.push(n);
      }),
    ).toBe(0);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('continues past a rejection and counts it', async () => {
    const seen: number[] = [];
    const failures = await settleAll([1, 2, 3], async (n) => {
      seen.push(n);
      if (n === 2) throw new Error('boom');
    });

    expect(failures).toBe(1);
    // The item after the failure must still have run.
    expect(seen).toEqual([1, 2, 3]);
  });

  it('counts every failure, not just the first', async () => {
    const failures = await settleAll([1, 2, 3], async () => {
      throw new Error('boom');
    });
    expect(failures).toBe(3);
  });

  it('runs items sequentially, not concurrently', async () => {
    // These are AWS-backed writes; an unbounded concurrent fan-out would be a
    // self-inflicted throttle problem.
    let active = 0;
    let peak = 0;
    await settleAll([1, 2, 3, 4], async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBe(1);
  });

  it('handles an empty collection', async () => {
    expect(await settleAll([], async () => undefined)).toBe(0);
  });
});

describe('saveRoleRelationships', () => {
  const roles: DiscoveredRole[] = [
    { roleName: 'Dev', arn: 'arn:aws:iam::123456789012:role/Dev', description: 'dev' },
    { roleName: 'Ops', arn: 'arn:aws:iam::123456789012:role/Ops', description: 'ops' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.storeCredentialRelationship.mockResolvedValue(undefined);
  });

  it('stores one relationship per selected role', async () => {
    const result = await saveRoleRelationships(new Set(['Dev', 'Ops']), roles, 'arn:aws:iam::123456789012:role/Admin');

    expect(result).toEqual({ ok: true, attempted: 2, failures: 0 });
    expect(mocked.storeCredentialRelationship).toHaveBeenCalledTimes(2);
    expect(mocked.storeCredentialRelationship).toHaveBeenCalledWith(
      'arn:aws:iam::123456789012:role/Dev',
      'arn:aws:iam::123456789012:role/Admin',
    );
  });

  it('skips a manually added role, which has no ARN', async () => {
    // There is no ARN to store against; calling with an empty one would create a
    // relationship row that resolves to nothing.
    const withManual: DiscoveredRole[] = [...roles, { roleName: 'Manual', arn: '', description: '(manually added)' }];
    const result = await saveRoleRelationships(new Set(['Dev', 'Manual']), withManual, 'arn:aws:iam::123456789012:role/Admin');

    expect(result).toEqual({ ok: true, attempted: 1, failures: 0 });
    expect(mocked.storeCredentialRelationship).toHaveBeenCalledTimes(1);
  });

  it('skips a selected role that discovery never returned', async () => {
    const result = await saveRoleRelationships(new Set(['Dev', 'Ghost']), roles, 'arn:aws:iam::123456789012:role/Admin');

    expect(result).toEqual({ ok: true, attempted: 1, failures: 0 });
  });

  it('reports a failure without abandoning the remaining roles', async () => {
    mocked.storeCredentialRelationship.mockImplementation((arn) =>
      arn.includes('/Dev') ? Promise.reject(new Error('denied')) : Promise.resolve(),
    );

    const result = await saveRoleRelationships(new Set(['Dev', 'Ops']), roles, 'arn:aws:iam::123456789012:role/Admin');

    expect(result).toEqual({ ok: false, attempted: 2, failures: 1 });
    // Ops still saved, so a single bad ARN does not leave the wizard half-done.
    expect(mocked.storeCredentialRelationship).toHaveBeenCalledTimes(2);
  });

  it('treats an empty selection as success', async () => {
    const result = await saveRoleRelationships(new Set(), roles, 'arn:aws:iam::123456789012:role/Admin');
    expect(result).toEqual({ ok: true, attempted: 0, failures: 0 });
    expect(mocked.storeCredentialRelationship).not.toHaveBeenCalled();
  });

  it('treats a selection with no resolvable ARN as success', async () => {
    // Nothing was attempted, so there is nothing that could have failed; the
    // wizard must still be able to advance.
    const result = await saveRoleRelationships(
      new Set(['Manual']),
      [{ roleName: 'Manual', arn: '', description: '' }],
      'arn:aws:iam::123456789012:role/Admin',
    );
    expect(result.ok).toBe(true);
  });
});

describe('grantSelectedRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.grantAccess.mockResolvedValue(undefined);
  });

  it('grants every role to every address', async () => {
    const result = await grantSelectedRoles(['a@example.com', 'b@example.com'], new Set(['Dev', 'Ops']), '123456789012');

    expect(result).toEqual({ attempted: 4, failures: 0 });
    expect(mocked.grantAccess).toHaveBeenCalledTimes(4);
    expect(mocked.grantAccess).toHaveBeenCalledWith('a@example.com', '123456789012', 'Dev');
    expect(mocked.grantAccess).toHaveBeenCalledWith('b@example.com', '123456789012', 'Ops');
  });

  it('drops a blank address entry', async () => {
    // The route falls back to the authenticated admin only when the field is
    // absent, so a blank string would be treated as a real invalid address.
    const result = await grantSelectedRoles(['a@example.com', '', ' '.repeat(3)], new Set(['Dev']), '123456789012');

    expect(result.attempted).toBe(1);
    for (const [email] of mocked.grantAccess.mock.calls) {
      expect(email).toBe('a@example.com');
    }
  });

  it('trims surrounding whitespace', async () => {
    await grantSelectedRoles(['  a@example.com  '], new Set(['Dev']), '123456789012');
    expect(mocked.grantAccess).toHaveBeenCalledWith('a@example.com', '123456789012', 'Dev');
  });

  it('counts failures and still attempts every pair', async () => {
    mocked.grantAccess.mockImplementation((email) => (email === 'b@example.com' ? Promise.reject(new Error('denied')) : Promise.resolve()));

    const result = await grantSelectedRoles(['a@example.com', 'b@example.com'], new Set(['Dev', 'Ops']), '123456789012');

    expect(result).toEqual({ attempted: 4, failures: 2 });
    expect(mocked.grantAccess).toHaveBeenCalledTimes(4);
  });

  it('does nothing for no addresses or no roles', async () => {
    expect(await grantSelectedRoles([], new Set(['Dev']), '123456789012')).toEqual({ attempted: 0, failures: 0 });
    expect(await grantSelectedRoles(['a@example.com'], new Set(), '123456789012')).toEqual({ attempted: 0, failures: 0 });
    expect(await grantSelectedRoles(['', '  '], new Set(['Dev']), '123456789012')).toEqual({ attempted: 0, failures: 0 });
    expect(mocked.grantAccess).not.toHaveBeenCalled();
  });
});
