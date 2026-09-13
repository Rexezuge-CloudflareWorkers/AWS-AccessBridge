import { describe, it, expect, vi } from 'vitest';
import { assertD1Success, executeD1WithRetry } from '@aws-access-bridge/backend-data/utils';
import { isD1ErrorRetryable } from '@aws-access-bridge/backend-data/utils';
import { createD1SessionEnv } from '@aws-access-bridge/backend-data/utils';
import { DatabaseError } from '@aws-access-bridge/backend-errors';

describe('isD1ErrorRetryable', () => {
  it('matches retryable signals', () => {
    for (const message of ['database is BUSY', 'timed out waiting', 'connection reset', 'too many requests', 'deadlock detected']) {
      expect(isD1ErrorRetryable(message)).toBe(true);
    }
  });

  it('rejects non-retryable and empty signals', () => {
    for (const message of ['', 'FOREIGN KEY constraint failed', 'no such table: x', 'syntax error', 'permission denied', 'plain failure']) {
      expect(isD1ErrorRetryable(message)).toBe(false);
    }
  });

  it('prefers non-retryable when both match', () => {
    expect(isD1ErrorRetryable('constraint failed during busy transaction')).toBe(false);
  });
});

describe('assertD1Success', () => {
  it('passes through success and flags retryable failures', () => {
    expect(() => assertD1Success({ success: true } as D1Result, 'op')).not.toThrow();
    try {
      assertD1Success({ success: false, error: 'database is locked' } as unknown as D1Result, 'write row');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).retryable).toBe(true);
    }
  });
});

describe('executeD1WithRetry', () => {
  it('returns the first success', async () => {
    const operation = vi.fn().mockResolvedValue({ success: true });
    await expect(executeD1WithRetry(operation, 'op', { baseDelayMs: 1 })).resolves.toEqual({ success: true });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries retryable result failures then succeeds', async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'database is busy' })
      .mockResolvedValueOnce({ success: true });
    await expect(executeD1WithRetry(operation, 'op', { baseDelayMs: 1 })).resolves.toEqual({ success: true });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('throws immediately for non-retryable results', async () => {
    const operation = vi.fn().mockResolvedValue({ success: false, error: 'FOREIGN KEY constraint failed' });
    await expect(executeD1WithRetry(operation, 'op', { baseDelayMs: 1 })).rejects.toBeInstanceOf(DatabaseError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries retryable DatabaseErrors and rethrows exhausted ones', async () => {
    const operation = vi.fn().mockRejectedValue(new DatabaseError('busy', true));
    await expect(executeD1WithRetry(operation, 'op', { maxRetries: 1, baseDelayMs: 1 })).rejects.toBeInstanceOf(DatabaseError);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('wraps generic errors with retryability classification', async () => {
    const retryable = vi.fn().mockRejectedValue(new Error('network unreachable'));
    await expect(executeD1WithRetry(retryable, 'op', { maxRetries: 0, baseDelayMs: 1 })).rejects.toBeInstanceOf(DatabaseError);
    const fatal = vi.fn().mockRejectedValue(new Error('syntax error near table'));
    await expect(executeD1WithRetry(fatal, 'op', { baseDelayMs: 1 })).rejects.toBeInstanceOf(DatabaseError);
    const alien = vi.fn().mockRejectedValue('a string, not an error');
    await expect(executeD1WithRetry(alien, 'op', { baseDelayMs: 1 })).rejects.toBe('a string, not an error');
  });
});

describe('createD1SessionEnv', () => {
  it('binds sessions with default and explicit constraints', () => {
    const session = { fake: true };
    const db = { withSession: vi.fn().mockReturnValue(session) };
    const scoped = createD1SessionEnv({ AccessBridgeDB: db, other: 1 } as never);
    expect(scoped.AccessBridgeDB).toBe(session);
    expect(db.withSession).toHaveBeenCalledWith('first-primary');
    createD1SessionEnv({ AccessBridgeDB: db } as never, 'first-unconstrained');
    expect(db.withSession).toHaveBeenLastCalledWith('first-unconstrained');
  });
});
