import { describe, it, expect } from 'vitest';
import { maxTrend, sortAccountsByCost, trendBarPercent } from '@aws-access-bridge/web/lib/costTrends';
import { parsePositiveNumber } from '@aws-access-bridge/web/lib/numbers';
import { clampPage, pageRange, totalPages } from '@aws-access-bridge/web/lib/pagination';
import { defaultRoleSelection } from '@aws-access-bridge/web/lib/roleSelection';
import { readStoredInt } from '@aws-access-bridge/web/lib/storage';
import { DEFAULT_TEAM_ROLE, TEAM_ROLES, isTeamRole } from '@aws-access-bridge/web/lib/teamRoles';
import { afterSuccess, runAction } from '@aws-access-bridge/web/lib/asyncAction';
import {
  EMPTY_CHAIN,
  EMPTY_CREDENTIALS,
  LAST_WIZARD_STEP,
  WIZARD_STEP,
  addManualRole,
  canAdvanceFromStep,
  editCredentialField,
  editIntermediateRoleArn,
  nextStep,
  previousStep,
  resolveAssumedByArn,
  toggleSelection,
  validEmails,
} from '@aws-access-bridge/web/lib/onboardingWizard';

describe('costTrends', () => {
  it('floors the maximum at 1 so an all-zero series never divides by zero', () => {
    expect(maxTrend([])).toBe(1);
    expect(maxTrend([{ total: 0 }, { total: 0 }])).toBe(1);
    expect(maxTrend([{ total: 5 }, { total: 9 }, { total: NaN }])).toBe(9);
  });

  it('clamps a bar to [0, 100]', () => {
    expect(trendBarPercent(5, 10)).toBe(50);
    expect(trendBarPercent(-5, 10)).toBe(0);
    expect(trendBarPercent(20, 10)).toBe(100);
    expect(trendBarPercent(5, 0)).toBe(0);
    expect(trendBarPercent(NaN, 10)).toBe(0);
  });

  it('sorts accounts by spend without mutating the input', () => {
    const input = { a: { totalCost: 1 }, b: { totalCost: 9 }, c: { totalCost: 5 } };
    expect(sortAccountsByCost(input).map(([id]) => id)).toEqual(['b', 'c', 'a']);
    expect(Object.keys(input)).toEqual(['a', 'b', 'c']);
  });
});

describe('parsePositiveNumber', () => {
  it('accepts a positive number and rejects everything else', () => {
    expect(parsePositiveNumber('12.5')).toBe(12.5);
    expect(parsePositiveNumber(' 7 ')).toBe(7);
    // `Number('')` is 0 and `JSON.stringify(NaN)` is null: the old call site sent
    // the API a `null` threshold.
    expect(parsePositiveNumber('')).toBeNull();
    expect(parsePositiveNumber(' '.repeat(3))).toBeNull();
    expect(parsePositiveNumber('abc')).toBeNull();
    expect(parsePositiveNumber('0')).toBeNull();
    expect(parsePositiveNumber('-5')).toBeNull();
    expect(parsePositiveNumber('Infinity')).toBeNull();
  });

  it('honours the integer, min and max options', () => {
    expect(parsePositiveNumber('1.5', { integer: true })).toBeNull();
    expect(parsePositiveNumber('2', { integer: true })).toBe(2);
    expect(parsePositiveNumber('0.5', { min: 1 })).toBeNull();
    expect(parsePositiveNumber('5', { max: 10 })).toBe(5);
    expect(parsePositiveNumber('11', { max: 10 })).toBeNull();
  });
});

describe('pagination arithmetic', () => {
  it('never reports Infinity or NaN pages', () => {
    expect(totalPages(34, 10)).toBe(4);
    expect(totalPages(0, 10)).toBe(0);
    expect(totalPages(10, 0)).toBe(0);
    expect(totalPages(NaN, 10)).toBe(0);
  });

  it('pins a page into [1, pages]', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(3, 0)).toBe(1);
    expect(clampPage(NaN, 5)).toBe(1);
    expect(clampPage(3.7, 5)).toBe(3);
  });

  it('clamps the range to the total, including a short last page', () => {
    expect(pageRange(1, 10, 34)).toEqual({ from: 1, to: 10 });
    expect(pageRange(4, 10, 34)).toEqual({ from: 31, to: 34 });
    expect(pageRange(1, 10, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('defaultRoleSelection', () => {
  it('defaults a missing or stale selection and keeps a valid one', () => {
    expect(defaultRoleSelection({}, { a: ['Dev', 'Ops'] })).toEqual({ a: 'Dev' });
    expect(defaultRoleSelection({ a: 'Dev' }, { a: ['Dev', 'Ops'] })).toEqual({ a: 'Dev' });
    expect(defaultRoleSelection({ a: 'Gone' }, { a: ['Dev'] })).toEqual({ a: 'Dev' });
  });

  it('leaves an account with no roles alone and returns the same object when nothing changed', () => {
    const previous = { a: 'Dev' };
    expect(defaultRoleSelection(previous, { a: [], b: [] })).toBe(previous);
  });
});

describe('readStoredInt', () => {
  const storage = (value: string | null): { getItem: () => string | null } => ({ getItem: () => value });

  it('reads a usable value and falls back on everything else', () => {
    expect(readStoredInt(storage('25'), 'k', 50)).toBe(25);
    expect(readStoredInt(storage(null), 'k', 50)).toBe(50);
    expect(readStoredInt(storage(''), 'k', 50)).toBe(50);
    // `Math.trunc(Number('abc'))` was NaN and flowed into the API's limit.
    expect(readStoredInt(storage('abc'), 'k', 50)).toBe(50);
    expect(readStoredInt(storage('-5'), 'k', 50)).toBe(50);
    expect(readStoredInt(storage('7.9'), 'k', 50)).toBe(7);
    expect(readStoredInt(storage('2'), 'k', 50, 10)).toBe(50);
  });

  it('survives storage that throws, and absent storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredInt(throwing, 'k', 50)).toBe(50);
    expect(readStoredInt(null, 'k', 50)).toBe(50);
  });
});

describe('team roles', () => {
  it('narrows a select value against the list the server accepts', () => {
    expect(TEAM_ROLES).toEqual(['member', 'admin']);
    expect(DEFAULT_TEAM_ROLE).toBe('member');
    expect(isTeamRole('admin')).toBe(true);
    expect(isTeamRole('superadmin')).toBe(false);
  });
});

/**
 * A rejected promise whose reason is a bare string: the shape a `fetch` or a
 * hand-rolled client can produce, and the one `toErrorMessage` must not choke on.
 */
class NonError extends Error {}

describe('runAction / afterSuccess', () => {
  it('turns a rejection into a result with display text', async () => {
    await expect(runAction(async () => 1, 'boom')).resolves.toEqual({ ok: true, value: 1 });
    const failed = await runAction(async () => {
      throw new Error('nope');
    }, 'Could not save.');
    expect(failed).toMatchObject({ ok: false, message: 'nope' });
    const nonError = await runAction(async () => {
      throw new NonError('stringly');
    }, 'Could not save.');
    expect(nonError).toMatchObject({ ok: false, message: 'stringly' });
  });

  it('runs the refresh only after the write succeeded', async () => {
    const seen: string[] = [];
    await afterSuccess(
      async (id: string) => {
        seen.push(`write:${id}`);
        return id;
      },
      async (id: string) => {
        seen.push(`refresh:${id}`);
      },
    )('t1');
    expect(seen).toEqual(['write:t1', 'refresh:t1']);

    seen.length = 0;
    await expect(
      afterSuccess(
        async () => {
          throw new Error('write failed');
        },
        async () => {
          seen.push('refresh');
        },
      )(),
    ).rejects.toThrow('write failed');
    // A refresh after a failed write only re-reads state the write never changed.
    expect(seen).toEqual([]);
  });
});

describe('wizard rules', () => {
  const flags = { accountSaved: true, credentialStored: true, selectedRoleCount: 1 };

  it('walks the steps and stops at both ends', () => {
    expect(nextStep(WIZARD_STEP.ACCOUNT)).toBe(WIZARD_STEP.CREDENTIALS);
    expect(nextStep(LAST_WIZARD_STEP)).toBe(LAST_WIZARD_STEP);
    expect(previousStep(WIZARD_STEP.CREDENTIALS)).toBe(WIZARD_STEP.ACCOUNT);
    expect(previousStep(WIZARD_STEP.ACCOUNT)).toBe(WIZARD_STEP.ACCOUNT);
  });

  it('gates on what each step persists, and always lets the optional steps through', () => {
    expect(canAdvanceFromStep(WIZARD_STEP.ACCOUNT, flags)).toBe(true);
    expect(canAdvanceFromStep(WIZARD_STEP.ACCOUNT, { ...flags, accountSaved: false })).toBe(false);
    expect(canAdvanceFromStep(WIZARD_STEP.CREDENTIALS, { ...flags, credentialStored: false })).toBe(false);
    expect(canAdvanceFromStep(WIZARD_STEP.ROLES, { ...flags, selectedRoleCount: 0 })).toBe(false);
    expect(canAdvanceFromStep(WIZARD_STEP.CHAIN, flags)).toBe(true);
    expect(canAdvanceFromStep(WIZARD_STEP.USERS, flags)).toBe(true);
    expect(canAdvanceFromStep(WIZARD_STEP.SUMMARY, flags)).toBe(false);
  });

  it('invalidates a validation when a credential field is edited', () => {
    const validated = {
      ...EMPTY_CREDENTIALS,
      credentialValidated: true,
      credentialStored: true,
      validationResult: { arn: 'a', accountId: '1' },
    };
    const edited = editCredentialField(validated, 'secretAccessKey', 'new');
    expect(edited).toMatchObject({ secretAccessKey: 'new', credentialValidated: false, validationResult: null });
    // What was already written to the server stays written.
    expect(edited.credentialStored).toBe(true);
  });

  it('un-configures the chain when the intermediate ARN changes', () => {
    const configured = {
      ...EMPTY_CHAIN,
      chainConfigured: true,
      chainTestResult: [{ arn: 'a', status: 'ok' }],
      roleForDiscovery: 'saved-arn',
    };
    expect(editIntermediateRoleArn(configured, 'other')).toMatchObject({
      intermediateRoleArn: 'other',
      chainConfigured: false,
      chainTestResult: null,
    });
    // `roleForDiscovery` is what was last *saved*.
    expect(editIntermediateRoleArn(configured, 'other').roleForDiscovery).toBe('saved-arn');
    expect(resolveAssumedByArn({ roleForDiscovery: '' }, 'principal')).toBe('principal');
    expect(resolveAssumedByArn({ roleForDiscovery: 'chain' }, 'principal')).toBe('chain');
  });

  it('adds a hand-typed role once and selects it', () => {
    expect(addManualRole([], new Set(), ' '.repeat(3), 'd')).toBeNull();
    const first = addManualRole([], new Set(), ' Ops ', 'desc');
    expect(first?.discoveredRoles).toEqual([{ roleName: 'Ops', arn: '', description: 'desc' }]);
    expect([...(first?.selectedRoles ?? [])]).toEqual(['Ops']);
    const again = addManualRole(first!.discoveredRoles, first!.selectedRoles, 'Ops', 'desc');
    expect(again?.discoveredRoles).toHaveLength(1);
    expect(again?.discoveredRoles).toBe(first!.discoveredRoles);
  });

  it('toggles a selection without mutating the input', () => {
    const original = new Set(['Dev']);
    const added = toggleSelection(original, 'Ops');
    expect([...added]).toEqual(['Dev', 'Ops']);
    expect([...toggleSelection(added, 'Dev')]).toEqual(['Ops']);
    expect([...original]).toEqual(['Dev']);
  });

  it('drops blank grant addresses', () => {
    expect(validEmails([' a@e.com ', '', ' '.repeat(3), 'b@e.com'])).toEqual(['a@e.com', 'b@e.com']);
  });
});
