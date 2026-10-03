import { describe, it, expect } from 'vitest';
import { createRequestGuard } from '@aws-access-bridge/web/lib/requestGuard';

/**
 * The ordering rule behind `useRequestGuard`, tested against the real factory
 * rather than a restatement of it — the repo's own testing notes are explicit
 * that a look-alike asserts the copy's behaviour, which is how a real bug once
 * shipped through a passing test.
 */
describe('createRequestGuard', () => {
  it('makes the newest request current and every earlier one stale', () => {
    const guard = createRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
  });

  it('keeps a request current until something supersedes it', () => {
    const guard = createRequestGuard();
    const only = guard.begin();

    expect(guard.isCurrent(only)).toBe(true);
    // Idempotent: re-checking the newest id does not retire it.
    expect(guard.isCurrent(only)).toBe(true);
    expect(guard.isCurrent(only)).toBe(true);
  });

  it('issues distinct, increasing ids', () => {
    const guard = createRequestGuard();
    const ids = [guard.begin(), guard.begin(), guard.begin()];

    expect(new Set(ids).size).toBe(3);
    expect(guard.current()).toBe(ids[2]);
  });

  it('retires the in-flight request on invalidate without starting a new one', () => {
    const guard = createRequestGuard();
    const request = guard.begin();
    const before = guard.current();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
    // Invalidation is not a request. If it made a new id current, a later
    // comparison against a never-issued id would silently pass.
    expect(guard.current()).toBe(before + 1);
  });

  it('retires every pending id, not just the newest', () => {
    // The teams case: clearing a selection invalidates two independent guards,
    // each with its own in-flight request.
    const guard = createRequestGuard();
    const a = guard.begin();
    const b = guard.begin();
    const c = guard.begin();

    guard.invalidate();

    for (const id of [a, b, c]) {
      expect(guard.isCurrent(id)).toBe(false);
    }
  });

  it('is reusable after invalidate — the next begin() is current again', () => {
    // The clear-then-reselect flow. If invalidate poisoned the guard, selecting
    // a team again would leave every fetch permanently stale and the members
    // list would never populate.
    const guard = createRequestGuard();
    const stale = guard.begin();
    guard.invalidate();

    const fresh = guard.begin();

    expect(guard.isCurrent(fresh)).toBe(true);
    expect(guard.isCurrent(stale)).toBe(false);
  });

  it('refuses a stale response that resolves after a newer one (the search-box case)', () => {
    // Typing fires overlapping queries. The slow earlier request resolves last;
    // without the guard it would overwrite the newer selection's results.
    const guard = createRequestGuard();
    const slow = guard.begin();
    const fast = guard.begin();

    // The newer request resolves first and writes its state...
    expect(guard.isCurrent(fast)).toBe(true);
    // ...and the older one, resolving afterwards, is refused.
    expect(guard.isCurrent(slow)).toBe(false);
  });

  it('does not let a stale failure clear a newer request’s spinner', () => {
    const guard = createRequestGuard();
    const failing = guard.begin();
    const pending = guard.begin();

    // A stale rejection must not set the loading flag false on behalf of a
    // request still in flight, or the table renders as loaded while empty.
    expect(guard.isCurrent(failing)).toBe(false);
    expect(guard.isCurrent(pending)).toBe(true);
  });

  it('gives independent guards independent state', () => {
    // useTeams holds two: members and accounts. Retiring one must not affect
    // the other, or clearing a team's members would cancel its accounts load.
    const members = createRequestGuard();
    const accounts = createRequestGuard();

    const membersRequest = members.begin();
    const accountsRequest = accounts.begin();
    members.invalidate();

    expect(members.isCurrent(membersRequest)).toBe(false);
    expect(accounts.isCurrent(accountsRequest)).toBe(true);
  });
});