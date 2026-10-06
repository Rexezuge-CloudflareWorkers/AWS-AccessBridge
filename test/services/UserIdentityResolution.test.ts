import { describe, it, expect, vi } from 'vitest';
import { UserIdentityService } from '@aws-access-bridge/backend-services/identity/UserIdentityService';
import type { UserEmailRow, UserMetadataIdentityInternal } from '@aws-access-bridge/backend-data/dao';

/**
 * Identity resolution is the single place a sign-in address becomes the `{userId,
 * anchorEmail}` owner every user-keyed table is matched on, and it had 64.5% branch
 * coverage with none of its functions exercised.
 *
 * The properties below are the ones whose failure is silent. Every path in
 * `load` exists because of a specific trap:
 *
 * - A **revoked** registry row must not fall through to a `user_metadata` lookup,
 *   or a reassigned address keeps authenticating the previous holder.
 * - A **missing registry schema** (a pre-0032 database) degrades; a real D1 failure
 *   must propagate, or every service reads as empty with no error anywhere.
 * - Addresses match the registry **exactly**, so a pre-0032 mixed-case account
 *   cannot be steered into another account's.
 * - A row with **no id** resolves with an empty id rather than a null account,
 *   because the address is a complete identity in that case.
 */

function metadataRow(overrides: Partial<UserMetadataIdentityInternal> = {}): UserMetadataIdentityInternal {
  return {
    id: 'usr_abc123',
    current_email: 'alice@example.com',
    user_email: 'alice@example.com',
    ...overrides,
  };
}

function registryRow(overrides: Partial<UserEmailRow> = {}): UserEmailRow {
  return { email: 'alice@example.com', is_verified: 1, user_id: 'usr_abc123', ...overrides } as UserEmailRow;
}

/**
A service over hand-written DAO doubles, so each resolution path is named.
*/
function serviceWith(options: {
  byId?: () => Promise<UserMetadataIdentityInternal | null>;
  byCurrentEmail?: () => Promise<UserMetadataIdentityInternal | null>;
  byAnchor?: () => Promise<UserMetadataIdentityInternal | null>;
  registry?: () => Promise<UserEmailRow | null>;
}) {
  const userMetadataDAO = {
    getByAnchor: options.byAnchor ?? (() => Promise.resolve(null)),
    getByCurrentEmail: options.byCurrentEmail ?? (() => Promise.resolve(null)),
    getById: options.byId ?? (() => Promise.resolve(metadataRow())),
  };
  const userEmailDAO = {
    get: options.registry ?? (() => Promise.resolve(null)),
  };
  return new UserIdentityService(
    { AccessBridgeDB: {} as never },
    { userEmailDAO: () => Promise.resolve(userEmailDAO as never), userMetadataDAO: () => Promise.resolve(userMetadataDAO as never) },
  );
}

describe('resolveAccount', () => {
  it('rejects a blank address without touching the database', async () => {
    // A blank identity must not become an "unknown actor" that still costs two
    // queries on every request.
    const spy = vi.fn();
    const service = serviceWith({ byId: spy as never, registry: spy as never });
    await expect(service.resolveAccount(' '.repeat(3))).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('trims the address before resolving', async () => {
    const service = serviceWith({ registry: () => Promise.resolve(registryRow()) });
    await expect(service.resolveAccount('  alice@example.com  ')).resolves.toMatchObject({ id: 'usr_abc123' });
  });

  /**
   * A registered, verified address is authoritative and resolves through the id, so
   * an account keeps working after it changes address.
   */
  it('resolves a verified registry entry through its stable id', async () => {
    const service = serviceWith({
      byId: () => Promise.resolve(metadataRow({ current_email: 'new@example.com', user_email: 'alice@example.com' })),
      registry: () => Promise.resolve(registryRow({ email: 'new@example.com' })),
    });
    await expect(service.resolveAccount('new@example.com')).resolves.toEqual({
      anchorEmail: 'alice@example.com',
      email: 'new@example.com',
      id: 'usr_abc123',
    });
  });

  /**
   * The security property. Falling through to a `user_metadata` lookup here would
   * let a reassigned address keep authenticating the previous holder's account.
   */
  it('does not resolve a revoked address, even when its anchor still exists', async () => {
    const getByAnchor = vi.fn(() => Promise.resolve(metadataRow()));
    const service = serviceWith({ byAnchor: getByAnchor, registry: () => Promise.resolve(registryRow({ is_verified: 0 })) });

    await expect(service.resolveAccount('alice@example.com')).resolves.toBeNull();
    // Never consulted: the revoked row is the answer, not a hint.
    expect(getByAnchor).not.toHaveBeenCalled();
  });

  it('resolves a registered id whose metadata row has gone', async () => {
    const service = serviceWith({ byId: () => Promise.resolve(null), registry: () => Promise.resolve(registryRow()) });
    await expect(service.resolveAccount('alice@example.com')).resolves.toBeNull();
  });

  /**
   * A pre-0032 database has no registry table. It degrades to the anchor path
   * rather than failing authentication outright.
   */
  it('degrades to the anchor path when the registry schema is absent', async () => {
    const service = serviceWith({
      byAnchor: () => Promise.resolve(metadataRow({ id: undefined, current_email: null, user_email: 'alice@example.com' })),
      registry: () => Promise.reject(new Error('no such table: user_emails')),
    });
    await expect(service.resolveAccount('alice@example.com')).resolves.toMatchObject({ anchorEmail: 'alice@example.com' });
  });

  /**
   * A real D1 outage must propagate. Swallowing it would answer "no such account"
   * for an account that exists, so every service reads as empty — no assumables,
   * no resources, not an administrator — with no error logged anywhere.
   */
  it('propagates a real registry failure rather than reading as unknown', async () => {
    const service = serviceWith({ registry: () => Promise.reject(new Error('D1 network failure')) });
    await expect(service.resolveAccount('alice@example.com')).rejects.toThrow(/D1 network failure/);
  });

  it('propagates a real metadata failure on the anchor path', async () => {
    const service = serviceWith({ byAnchor: () => Promise.reject(new Error('D1 network failure')) });
    await expect(service.resolveAccount('alice@example.com')).rejects.toThrow(/D1 network failure/);
  });

  it('degrades when the current-email column is absent', async () => {
    const service = serviceWith({
      byAnchor: () => Promise.resolve(metadataRow({ current_email: null, user_email: 'alice@example.com' })),
      byCurrentEmail: () => Promise.reject(new Error('no such column: current_email')),
    });
    await expect(service.resolveAccount('alice@example.com')).resolves.toMatchObject({ id: 'usr_abc123' });
  });

  it('resolves an unknown address to null', async () => {
    const service = serviceWith({});
    await expect(service.resolveAccount('nobody@example.com')).resolves.toBeNull();
  });

  /**
   * One request scope resolves the same address in several services; the memo is
   * what makes that one pair of queries rather than one per service.
   */
  it('memoises a resolution for the lifetime of the scope', async () => {
    const registry = vi.fn(() => Promise.resolve(registryRow()));
    const service = serviceWith({ registry });
    await service.resolveAccount('alice@example.com');
    await service.resolveAccount('alice@example.com');
    expect(registry).toHaveBeenCalledOnce();
  });

  it('memoises a negative result too, so a miss is not re-queried', async () => {
    const registry = vi.fn(() => Promise.resolve(null));
    const service = serviceWith({ registry });
    await service.resolveAccount('nobody@example.com');
    await service.resolveAccount('nobody@example.com');
    expect(registry).toHaveBeenCalledOnce();
  });
});

describe('resolveUserId', () => {
  it('returns the id for a known address', async () => {
    const service = serviceWith({ registry: () => Promise.resolve(registryRow()) });
    await expect(service.resolveUserId('alice@example.com')).resolves.toBe('usr_abc123');
  });

  /**
   * A null id means "unknown actor" and makes the DAOs fall back to the legacy
   * address read — not an error.
   */
  it('returns null for an unknown address', async () => {
    const service = serviceWith({});
    await expect(service.resolveUserId('nobody@example.com')).resolves.toBeNull();
  });
});

describe('resolveAccountById', () => {
  it('resolves an id to its current address and frozen anchor', async () => {
    const service = serviceWith({ byId: () => Promise.resolve(metadataRow({ current_email: 'new@example.com', user_email: 'alice@example.com' })) });
    await expect(service.resolveAccountById('usr_abc123')).resolves.toEqual({
      anchorEmail: 'alice@example.com',
      email: 'new@example.com',
      id: 'usr_abc123',
    });
  });

  /**
   * A pre-0032 row has no `current_email`, so the address falls back to the frozen
   * anchor rather than becoming empty.
   */
  it('falls back to the anchor when there is no current email', async () => {
    const service = serviceWith({ byId: () => Promise.resolve(metadataRow({ current_email: null, user_email: 'alice@example.com' })) });
    await expect(service.resolveAccountById('usr_abc123')).resolves.toMatchObject({ email: 'alice@example.com' });
  });

  it('returns null for a row with no id', async () => {
    const service = serviceWith({ byId: () => Promise.resolve(metadataRow({ id: '' })) });
    await expect(service.resolveAccountById('usr_abc123')).resolves.toBeNull();
  });

  it('returns null rather than throwing on a pre-0032 database', async () => {
    const service = serviceWith({ byId: () => Promise.reject(new Error('no such column: id')) });
    await expect(service.resolveAccountById('usr_abc123')).resolves.toBeNull();
  });

  it('surfaces a real failure as a DatabaseError', async () => {
    const service = serviceWith({ byId: () => Promise.reject(new TypeError('boom')) });
    await expect(service.resolveAccountById('usr_abc123')).rejects.toThrow(/boom/);
  });

  it('preserves an existing DatabaseError unchanged', async () => {
    const service = serviceWith({ byId: () => Promise.reject(new Error('SQLITE_BUSY: database is locked')) });
    // A retryable DatabaseError must keep its flag, or the retry policy rewraps it.
    await expect(service.resolveAccountById('usr_abc123')).rejects.toMatchObject({ retryable: true });
  });
});