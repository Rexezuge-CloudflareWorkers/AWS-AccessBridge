import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { UserIdentityService, idOf } from '@aws-access-bridge/backend-services/identity';
import type { AccountIdentity, UserIdentityEnv } from '@aws-access-bridge/backend-services/identity';
import { BadRequestError, ConflictError } from '@aws-access-bridge/backend-errors';
import type { UserEmailRow } from '@aws-access-bridge/backend-data/dao';
import type { UserEmailDAO } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';
import type { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao/UserMetadataDAO';

const NOW = 1_700_000_000;

function env(): UserIdentityEnv {
  return { AccessBridgeDB: {} } as never;
}

function row(overrides: Partial<UserEmailRow> = {}): UserEmailRow {
  return { email: 'user@example.com', user_id: 'usr_abc', is_verified: 1, created_at: NOW, ...overrides };
}

function account(overrides: Partial<AccountIdentity> = {}): AccountIdentity {
  return { id: 'usr_abc', email: 'user@example.com', anchorEmail: 'user@example.com', ...overrides };
}

/**
 * Every member typed from the DAO method it stands in for.
 *
 * These were all `ReturnType<typeof vi.fn>`, which resolves to **`void`**: vitest's
 * default `Procedure` returns `void`, so `ReturnType` picked that rather than the
 * `any` the code appeared to get. The consequence was that `mockImplementation(() =>
 * Promise.resolve('claimed'))` was an arrow returning a promise where a `void` return
 * was expected — three errors that all read as "this test's callback is wrong" and none
 * of which was.
 *
 * Naming the production method makes the double carry the real signature, so a `register`
 * that resolved nothing, or took the wrong argument, would be reported here rather than
 * silently accepted.
 */
interface Harness {
  service: UserIdentityService;
  emailDAO: {
    get: MockedFunction<typeof UserEmailDAO.prototype.get>;
    register: MockedFunction<typeof UserEmailDAO.prototype.register>;
    revokeAllVerified: MockedFunction<typeof UserEmailDAO.prototype.revokeAllVerified>;
    listByUserId: MockedFunction<typeof UserEmailDAO.prototype.listByUserId>;
  };
  metadataDAO: {
    getById: MockedFunction<typeof UserMetadataDAO.prototype.getById>;
    getByCurrentEmail: MockedFunction<typeof UserMetadataDAO.prototype.getByCurrentEmail>;
    getByAnchor: MockedFunction<typeof UserMetadataDAO.prototype.getByAnchor>;
    setCurrentEmail: MockedFunction<typeof UserMetadataDAO.prototype.setCurrentEmail>;
  };
}

/**
 * Injectable DAOs rather than a D1 double: the resolution ORDER is the security
 * property under test, and it is only observable if each store can be made to
 * answer differently.
 */
function harness(opts: { registry?: UserEmailRow | null; byCurrent?: unknown; byAnchor?: unknown } = {}): Harness {
  const emailDAO = {
    get: vi.fn().mockResolvedValue(opts.registry ?? null),
    register: vi.fn().mockResolvedValue('claimed'),
    revokeAllVerified: vi.fn().mockResolvedValue(undefined),
    listByUserId: vi.fn().mockResolvedValue([]),
  };
  const metadataDAO = {
    getById: vi.fn().mockResolvedValue({ user_email: 'user@example.com', id: 'usr_abc', current_email: 'user@example.com' }),
    getByCurrentEmail: vi.fn().mockResolvedValue(opts.byCurrent ?? null),
    getByAnchor: vi.fn().mockResolvedValue(opts.byAnchor ?? null),
    setCurrentEmail: vi.fn().mockResolvedValue(undefined),
  };
  const service = new UserIdentityService(env(), {
    userEmailDAO: () => Promise.resolve(emailDAO as never),
    userMetadataDAO: () => Promise.resolve(metadataDAO as never),
  });
  return { service, emailDAO, metadataDAO };
}

describe('UserIdentityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveAccount', () => {
    it('resolves a verified registry address to its account', async () => {
      const { service, emailDAO } = harness({ registry: row() });
      await expect(service.resolveAccount('user@example.com')).resolves.toEqual(account());
      expect(emailDAO.get).toHaveBeenCalledWith('user@example.com');
    });

    // The core revocation property. Falling through to the anchor lookup here
    // would let a reassigned company address keep authenticating the previous
    // holder's account.
    it('never resolves a revoked address, even though its account still exists', async () => {
      const { service, metadataDAO } = harness({ registry: row({ is_verified: 0 }) });
      await expect(service.resolveAccount('user@example.com')).resolves.toBeNull();
      expect(metadataDAO.getByCurrentEmail).not.toHaveBeenCalled();
      expect(metadataDAO.getByAnchor).not.toHaveBeenCalled();
    });

    it('resolves through current_email when the registry has no row yet', async () => {
      const { service } = harness({
        byCurrent: { user_email: 'old@example.com', id: 'usr_abc', current_email: 'user@example.com' },
      });
      await expect(service.resolveAccount('user@example.com')).resolves.toEqual({
        id: 'usr_abc',
        email: 'user@example.com',
        anchorEmail: 'old@example.com',
      });
    });

    it('falls back to the anchor on a pre-0032 database', async () => {
      const { service } = harness({ byAnchor: { user_email: 'user@example.com', id: null, current_email: null } });
      await expect(service.resolveAccount('user@example.com')).resolves.toEqual({
        // No id: the address is the whole identity here.
        id: '',
        email: 'user@example.com',
        anchorEmail: 'user@example.com',
      });
    });

    it('returns null for an unknown address', async () => {
      const { service } = harness();
      await expect(service.resolveAccount('nobody@example.com')).resolves.toBeNull();
    });

    it('returns null for a blank address without touching the database', async () => {
      const { service, emailDAO } = harness();
      await expect(service.resolveAccount(' '.repeat(3))).resolves.toBeNull();
      expect(emailDAO.get).not.toHaveBeenCalled();
    });

    // One request scope, several services: the second lookup must not re-query.
    it('memoizes a resolution for the lifetime of the instance', async () => {
      const { service, emailDAO } = harness({ registry: row() });
      await service.resolveAccount('user@example.com');
      await service.resolveAccount('user@example.com');
      expect(emailDAO.get).toHaveBeenCalledTimes(1);
    });

    it('treats a missing registry table as "no row", not an outage', async () => {
      const service = new UserIdentityService(env(), {
        userEmailDAO: () =>
          Promise.resolve({
            get: vi.fn().mockRejectedValue(new Error('D1_ERROR: no such table: user_emails')),
            register: vi.fn(),
            revokeAllVerified: vi.fn(),
            listByUserId: vi.fn(),
          } as never),
        userMetadataDAO: () =>
          Promise.resolve({
            getById: vi.fn(),
            getByCurrentEmail: vi.fn().mockResolvedValue(null),
            getByAnchor: vi.fn().mockResolvedValue({ user_email: 'user@example.com', id: null, current_email: null }),
            setCurrentEmail: vi.fn(),
          } as never),
      });
      await expect(service.resolveAccount('user@example.com')).resolves.toMatchObject({ anchorEmail: 'user@example.com' });
    });

    // Only a *missing schema* may degrade. A constraint violation or a timeout
    // is a real fault and must not be mistaken for legacy data.
    it('propagates a genuine database error rather than degrading', async () => {
      const service = new UserIdentityService(env(), {
        userEmailDAO: () =>
          Promise.resolve({
            get: vi.fn().mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: user_emails.email')),
            register: vi.fn(),
            revokeAllVerified: vi.fn(),
            listByUserId: vi.fn(),
          } as never),
        userMetadataDAO: () =>
          Promise.resolve({
            getById: vi.fn(),
            getByCurrentEmail: vi.fn(),
            getByAnchor: vi.fn(),
            setCurrentEmail: vi.fn(),
          } as never),
      });
      await expect(service.resolveAccount('user@example.com')).rejects.toThrow(/UNIQUE constraint failed/);
    });

    // The registry lookup discriminates correctly, but three sibling lookups used
    // a bare `.catch(() => null)`. On a D1 outage `resolveAccount` therefore
    // answered "no such account" for an account that exists, and every service
    // reading through it silently returned empty — no assumables, no resources,
    // not a super-admin — with no error anywhere.
    it('propagates a D1 failure from the current_email lookup', async () => {
      const { service, metadataDAO } = harness();
      vi.mocked(metadataDAO.getByCurrentEmail).mockRejectedValue(new Error('D1_ERROR: database is locked'));
      await expect(service.resolveAccount('user@example.com')).rejects.toThrow(/database is locked/);
    });

    it('propagates a D1 failure from the anchor lookup', async () => {
      const { service, metadataDAO } = harness();
      vi.mocked(metadataDAO.getByAnchor).mockRejectedValue(new Error('D1_ERROR: database is locked'));
      await expect(service.resolveAccount('user@example.com')).rejects.toThrow(/database is locked/);
    });

    it('still degrades to the anchor for a pre-0032 database', async () => {
      const { service, metadataDAO } = harness({ byAnchor: { user_email: 'user@example.com', id: null, current_email: null } });
      vi.mocked(metadataDAO.getByCurrentEmail).mockRejectedValue(new Error('D1_ERROR: no such column: current_email'));
      await expect(service.resolveAccount('user@example.com')).resolves.toMatchObject({ anchorEmail: 'user@example.com' });
    });
  });

  describe('setPrimaryEmail claim guard', () => {
    /**
     * `isClaimedByOther` returning `false` on a failed lookup is an identity
     * takeover: the check is the only thing stopping one account from claiming an
     * address that is already a live login for another, and Cloudflare Access is
     * the sole authenticator so there is no proof-of-control step behind it.
     */
    it('refuses to proceed when the claim check fails, instead of claiming the address', async () => {
      const { service, metadataDAO, emailDAO } = harness();
      vi.mocked(metadataDAO.getById).mockResolvedValue({ user_email: 'old@example.com', id: 'usr_abc', current_email: 'old@example.com' });
      vi.mocked(emailDAO.get).mockRejectedValue(new Error('D1_ERROR: database is locked'));

      await expect(service.setPrimaryEmail('usr_abc', 'victim@example.com')).rejects.toThrow(/database is locked/);
      // The decisive assertion: nothing was written.
      expect(emailDAO.register).not.toHaveBeenCalled();
      expect(metadataDAO.setCurrentEmail).not.toHaveBeenCalled();
    });

    it('refuses when only the current_email probe fails', async () => {
      const { service, metadataDAO, emailDAO } = harness();
      vi.mocked(metadataDAO.getById).mockResolvedValue({ user_email: 'old@example.com', id: 'usr_abc', current_email: 'old@example.com' });
      vi.mocked(emailDAO.get).mockResolvedValue(null);
      vi.mocked(metadataDAO.getByCurrentEmail).mockRejectedValue(new Error('D1_ERROR: database is locked'));

      await expect(service.setPrimaryEmail('usr_abc', 'victim@example.com')).rejects.toThrow(/database is locked/);
      expect(emailDAO.register).not.toHaveBeenCalled();
    });

    it('rejects an address that is already verified for another account', async () => {
      const { service, metadataDAO, emailDAO } = harness();
      vi.mocked(metadataDAO.getById).mockResolvedValue({ user_email: 'old@example.com', id: 'usr_abc', current_email: 'old@example.com' });
      vi.mocked(emailDAO.get).mockResolvedValue({ email: 'victim@example.com', user_id: 'usr_other', is_verified: 1, created_at: NOW });

      await expect(service.setPrimaryEmail('usr_abc', 'victim@example.com')).rejects.toThrow(/already in use/);
      expect(emailDAO.register).not.toHaveBeenCalled();
    });
  });

  describe('resolveUserId', () => {
    it('returns the account id', async () => {
      const { service } = harness({ registry: row() });
      await expect(service.resolveUserId('user@example.com')).resolves.toBe('usr_abc');
    });

    it('returns null for an unknown address', async () => {
      const { service } = harness();
      await expect(service.resolveUserId('nobody@example.com')).resolves.toBeNull();
    });
  });

  describe('idOf', () => {
    it('passes a real id through', () => {
      expect(idOf(account())).toBe('usr_abc');
    });

    // Binding '' into a `user_id TEXT REFERENCES ...` column fails the foreign
    // key, so the empty id must become null at every write site.
    it('turns an empty or missing id into null', () => {
      expect(idOf(account({ id: '' }))).toBeNull();
      expect(idOf(null)).toBeNull();
    });
  });

  describe('resolveAccountById', () => {
    it('returns the current address for a stable id', async () => {
      const { service, metadataDAO } = harness();
      metadataDAO.getById.mockResolvedValue({ user_email: 'old@example.com', id: 'usr_abc', current_email: 'new@example.com' });
      await expect(service.resolveAccountById('usr_abc')).resolves.toEqual({
        id: 'usr_abc',
        email: 'new@example.com',
        anchorEmail: 'old@example.com',
      });
    });

    it('returns null for an unknown id', async () => {
      const { service, metadataDAO } = harness();
      metadataDAO.getById.mockResolvedValue(null);
      await expect(service.resolveAccountById('usr_missing')).resolves.toBeNull();
    });
  });

  describe('listAddresses', () => {
    it('returns every known address for an account', async () => {
      const { service, emailDAO } = harness();
      emailDAO.listByUserId.mockResolvedValue([row({ email: 'new@e.c', is_verified: 1 }), row({ email: 'old@e.c', is_verified: 0 })]);
      await expect(service.listAddresses('usr_abc')).resolves.toEqual([
        { email: 'new@e.c', isVerified: true },
        { email: 'old@e.c', isVerified: false },
      ]);
    });
  });

  describe('setPrimaryEmail', () => {
    function changeHarness() {
      const h = harness({ registry: row() });
      h.metadataDAO.getById.mockResolvedValue({
        user_email: 'old@example.com',
        id: 'usr_abc',
        current_email: 'old@example.com',
      });
      return h;
    }

    it('claims, moves, then revokes — in that order', async () => {
      const { service, emailDAO, metadataDAO } = changeHarness();
      const order: string[] = [];
      emailDAO.register.mockImplementation(() => {
        order.push('register');
        return Promise.resolve('claimed');
      });
      emailDAO.revokeAllVerified.mockImplementation(() => {
        order.push('revoke');
        return Promise.resolve(undefined);
      });
      metadataDAO.setCurrentEmail.mockImplementation(() => {
        order.push('setCurrentEmail');
        return Promise.resolve(undefined);
      });

      await expect(service.setPrimaryEmail('usr_abc', 'new@example.com')).resolves.toEqual({
        id: 'usr_abc',
        email: 'new@example.com',
        anchorEmail: 'old@example.com',
      });
      // Claiming before revoking is the safety property: the account is never
      // locked out. Revoking first opens a window where neither address works.
      expect(order).toEqual(['register', 'revoke', 'setCurrentEmail']);
    });

    it('never touches the frozen anchor', async () => {
      const { service, metadataDAO } = changeHarness();
      await service.setPrimaryEmail('usr_abc', 'new@example.com');
      expect(metadataDAO.setCurrentEmail).toHaveBeenCalledWith('usr_abc', 'new@example.com');
      // No statement in the service writes `user_email`; the FK targets stay.
      expect(JSON.stringify(metadataDAO.setCurrentEmail.mock.calls)).not.toContain('old@example.com');
    });

    it('revokes every other verified address for the account', async () => {
      const { service, emailDAO } = changeHarness();
      await service.setPrimaryEmail('usr_abc', 'new@example.com');
      expect(emailDAO.revokeAllVerified).toHaveBeenCalledWith('usr_abc', 'new@example.com');
    });

    it('rejects an address already claimed by another account', async () => {
      const { service, emailDAO } = changeHarness();
      emailDAO.register.mockResolvedValue('already-claimed');
      await expect(service.setPrimaryEmail('usr_abc', 'taken@example.com')).rejects.toBeInstanceOf(ConflictError);
    });

    // The registry key and the unique index on `current_email` are both
    // case-sensitive, so without an explicit case-insensitive check two
    // accounts could differ only by case and both sign in.
    it('rejects an address that differs only by case', async () => {
      // Constructed with the override rather than mutating `deps` afterwards:
      // `AddressRegistryService` captures its DAO factories at construction, so
      // a post-construction swap would not reach the code under test.
      const service = new UserIdentityService(env(), {
        userEmailDAO: () =>
          Promise.resolve({
            get: vi.fn().mockResolvedValue(row({ email: 'taken@example.com', user_id: 'usr_other' })),
            register: vi.fn(),
            revokeAllVerified: vi.fn(),
            listByUserId: vi.fn(),
          } as never),
        userMetadataDAO: () =>
          Promise.resolve({
            getById: vi.fn().mockResolvedValue({ user_email: 'old@example.com', id: 'usr_abc', current_email: 'old@example.com' }),
            getByCurrentEmail: vi.fn().mockResolvedValue(null),
            getByAnchor: vi.fn().mockResolvedValue(null),
            setCurrentEmail: vi.fn(),
          } as never),
      });
      await expect(service.setPrimaryEmail('usr_abc', 'TAKEN@example.com')).rejects.toBeInstanceOf(ConflictError);
    });

    it('is a no-op when the address is already current, ignoring case', async () => {
      const { service, emailDAO, metadataDAO } = changeHarness();
      await expect(service.setPrimaryEmail('usr_abc', 'OLD@example.com')).resolves.toEqual({
        id: 'usr_abc',
        email: 'old@example.com',
        anchorEmail: 'old@example.com',
      });
      expect(emailDAO.register).not.toHaveBeenCalled();
      expect(metadataDAO.setCurrentEmail).not.toHaveBeenCalled();
    });

    it('rejects a malformed address', async () => {
      const { service } = changeHarness();
      await expect(service.setPrimaryEmail('usr_abc', 'not-an-email')).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects an unknown account', async () => {
      const { service, metadataDAO } = changeHarness();
      metadataDAO.getById.mockResolvedValue(null);
      await expect(service.setPrimaryEmail('usr_missing', 'new@example.com')).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('linkVerifiedEmail', () => {
    it('attaches an address without making it the sign-in address', async () => {
      const { service, emailDAO, metadataDAO } = harness();
      await service.linkVerifiedEmail('usr_abc', 'alias@example.com');
      expect(emailDAO.register).toHaveBeenCalledWith({
        email: 'alias@example.com',
        userId: 'usr_abc',
        isVerified: true,
        now: expect.any(Number),
      });
      expect(metadataDAO.setCurrentEmail).not.toHaveBeenCalled();
    });

    it('rejects an address already claimed by another account', async () => {
      const { service, emailDAO } = harness();
      emailDAO.register.mockResolvedValue('already-claimed');
      await expect(service.linkVerifiedEmail('usr_abc', 'taken@example.com')).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects a malformed address', async () => {
      const { service } = harness();
      await expect(service.linkVerifiedEmail('usr_abc', 'nope')).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
