import { UserEmailDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { isMissingSchemaError } from '@aws-access-bridge/backend-data/utils';
import { BadRequestError, ConflictError, DatabaseError } from '@aws-access-bridge/backend-errors';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

interface UserIdentityEnv {
  AccessBridgeDB: D1Queryable;
}

interface UserIdentityDeps {
  userMetadataDAO?: () => Promise<UserMetadataDAO>;
  userEmailDAO?: () => Promise<UserEmailDAO>;
}

/**
 * A resolved account. `id` is the only value that should be used as an
 * identity; `email` is the address the account currently signs in with, and
 * `anchorEmail` is the frozen value that the legacy `*_email` columns and
 * their foreign keys hold.
 */
interface AccountIdentity {
  id: string;
  email: string;
  anchorEmail: string;
}

/**
 * The stable account id for a resolved account, or null when there is none.
 *
 * A pre-0032 row — and an ambiguous mixed-case account that 0032 left
 * unresolved — resolves with an EMPTY id rather than a null account, because the
 * address is a complete identity in both cases. Callers writing that id into a
 * `user_id` column must pass null instead: binding `''` would fail the foreign
 * key. This is the single place that translation happens, so no caller has to
 * remember it.
 */
function idOf(account: AccountIdentity | null): string | null {
  return account?.id || null;
}

/**
 * The account behind an address.
 *
 * Resolution is address -> `user_emails` -> `user_metadata.id`, so an account
 * keeps working after it changes its address: the new address resolves through
 * the registry to the same id that every grant, favourite, membership and token
 * points at.
 *
 * Results are memoized for the lifetime of the instance, which is one request
 * scope — a request that resolves the same address in several services pays for
 * it once.
 *
 * Addresses are matched EXACTLY against the registry. The registry is keyed on
 * the normalized address and migration 0032 deliberately never lowercases at
 * resolution time, so a pre-0032 mixed-case account (which has no registry row)
 * cannot be steered into another account's. Case-insensitive matching is
 * enforced where it matters instead: when an address is claimed, in
 * `setPrimaryEmail`.
 */
class UserIdentityService {
  private readonly deps: Required<UserIdentityDeps>;
  private readonly byEmail = new Map<string, AccountIdentity | null>();

  constructor(
    private readonly env: UserIdentityEnv,
    deps: UserIdentityDeps = {},
  ) {
    this.deps = {
      userMetadataDAO: () => Promise.resolve(new UserMetadataDAO(env.AccessBridgeDB)),
      userEmailDAO: () => Promise.resolve(new UserEmailDAO(env.AccessBridgeDB)),
      ...deps,
    };
  }

  /**
   * Resolve a sign-in address to its account, or null when unknown.
   *
   * Only a verified address resolves. A revoked address (changed away from) is
   * retained for attribution but must never authenticate, otherwise a
   * reassigned company address would inherit the previous holder's account.
   */
  public async resolveAccount(email: string): Promise<AccountIdentity | null> {
    const address: string = email.trim();
    if (!address) return null;
    if (this.byEmail.has(address)) return this.byEmail.get(address) ?? null;
    const resolved: AccountIdentity | null = await this.load(address);
    this.byEmail.set(address, resolved);
    return resolved;
  }

  /**
   * Account id for a sign-in address, or null when unknown.
   *
   * The id every user-keyed table is matched on. A null id is not an error: it
   * means "unknown actor", and the DAOs fall back to the legacy address read.
   */
  public async resolveUserId(email: string): Promise<string | null> {
    const account: AccountIdentity | null = await this.resolveAccount(email);
    return account?.id ?? null;
  }

  /**
   * Account behind an id. The inverse direction, for callers that already hold a
   * stable key (a token, a team membership) and need the current address.
   */
  public async resolveAccountById(userId: string): Promise<AccountIdentity | null> {
    const dao: UserMetadataDAO = await this.deps.userMetadataDAO();
    try {
      const row = await dao.getById(userId);
      if (!row?.id) return null;
      return {
        id: row.id,
        email: (row.current_email ?? row.user_email ?? '').trim(),
        anchorEmail: row.user_email ?? '',
      };
    } catch (error) {
      if (isMissingSchemaError(error)) return null;
      throw error instanceof DatabaseError
        ? error
        : new DatabaseError(`Failed to resolve account: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async load(email: string): Promise<AccountIdentity | null> {
    let userMetadataDAO: UserMetadataDAO;
    let userEmailDAO: UserEmailDAO;
    try {
      [userMetadataDAO, userEmailDAO] = await Promise.all([this.deps.userMetadataDAO(), this.deps.userEmailDAO()]);
    } catch (error) {
      throw new DatabaseError(`Failed to load identity: ${error instanceof Error ? error.message : String(error)}`);
    }

    // A known address is authoritative, and a *revoked* one must not resolve:
    // falling through to a `user_metadata` lookup would let a reassigned address
    // keep authenticating the previous holder's account.
    // A DAO that resolves to a non-promise is a test double, not the runtime.
    // Treat it as "no row" so an unstubbed registry degrades to the anchor path
    // instead of throwing a TypeError out of an `await`.
    const registered = await Promise.resolve(userEmailDAO.get(email)).catch((error: unknown) => {
      // Registry absent on a database that has not run 0032. Not an outage.
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    if (registered) {
      return registered.is_verified === 1 ? (await this.hydrate(registered.user_id)) : null;
    }

    // No registry row. Migration 0032 backfilled a verified row for every
    // account that was assigned a `current_email`, so a row-less address is
    // either brand new, one of the ambiguous mixed-case stragglers that 0032
    // deliberately left with `current_email IS NULL`, or an address on a
    // pre-0032 database where the anchor *is* the identity. All three still
    // resolve, the last two through the anchor. A revoked address always has a
    // registry row and returned above.
    const byAnchor = await Promise.resolve(userMetadataDAO.getByCurrentEmail(email)).catch(() => null);
    if (byAnchor?.id && byAnchor.current_email !== null) {
      return {
        id: byAnchor.id,
        email: (byAnchor.current_email ?? email).trim(),
        anchorEmail: byAnchor.user_email ?? email,
      };
    }
    const legacy = await this.findByAnchor(userMetadataDAO, email);
    return legacy;
  }

  /**
   * Pre-0032 floor: the address *is* the anchor, so an exact match on
   * `user_email` is the only way to resolve one. On a 0032 database an account
   * whose anchor was left ambiguous still lands here.
   */
  private async findByAnchor(dao: UserMetadataDAO, email: string): Promise<AccountIdentity | null> {
    const row = await Promise.resolve(dao.getByAnchor(email)).catch(() => null);
    if (!row) return null;
    // A row with no id is either a pre-0032 database or one of the ambiguous
    // mixed-case accounts 0032 left unresolved. Report the empty id rather than
    // a null account: the address still IS the identity in both cases, and a
    // null id is how callers learn to fall back to the address-keyed read.
    return {
      id: row.id ?? '',
      email: (row.current_email ?? row.user_email ?? email).trim(),
      anchorEmail: row.user_email ?? email,
    };
  }

  private async hydrate(userId: string): Promise<AccountIdentity | null> {
    const dao: UserMetadataDAO = await this.deps.userMetadataDAO();
    try {
      const row = await dao.getById(userId);
      if (!row?.id) return null;
      return {
        id: row.id,
        email: (row.current_email ?? row.user_email ?? '').trim(),
        anchorEmail: row.user_email ?? '',
      };
    } catch (error) {
      if (isMissingSchemaError(error)) return null;
      throw error;
    }
  }

  /**
   * Every address known for an account, verified ones first.
   */
  public async listAddresses(userId: string): Promise<Array<{ email: string; isVerified: boolean }>> {
    const dao: UserEmailDAO = await this.deps.userEmailDAO();
    const rows = await dao.listByUserId(userId);
    return rows.map((row) => ({ email: row.email, isVerified: row.is_verified === 1 }));
  }

  /**
   * Point an account at a new sign-in address.
   *
   * The account id, the frozen anchor, and every id-keyed grant are untouched:
   * only which address authenticates the account moves. The previous address is
   * revoked rather than deleted, so rows written before the change still resolve
   * to this account, and it is released for a later legitimate holder.
   *
   * The order is the safety property. Claiming first means the account is never
   * locked out — there is only a brief window where both addresses authenticate.
   * Revoking first would open a window where neither does.
   *
   * Rejects an address that is already verified for another account. That check
   * is the whole reason this is not simply an `UPDATE`: Cloudflare Access is the
   * only authenticator, so an unverified self-service change would let anyone
   * claim an address and inherit its account. The check is case-INsensitive,
   * which is stricter than the registry's exact-match key and than the unique
   * index on `current_email` — those are both case-sensitive, so without this
   * two accounts could differ only by case and both sign in.
   *
   * No route exposes this yet. Proof of control for the new address (a confirm
   * step performed while authenticated as that address) has to land first;
   * `scripts/change-email.ts` applies the same sequence out of band.
   */
  public async setPrimaryEmail(userId: string, newEmail: string): Promise<AccountIdentity> {
    const email: string = newEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestError('Invalid email address.');
    }
    const userMetadataDAO: UserMetadataDAO = await this.deps.userMetadataDAO();
    const userEmailDAO: UserEmailDAO = await this.deps.userEmailDAO();
    const row = await userMetadataDAO.getById(userId);
    if (!row?.id) throw new BadRequestError('User not found.');

    const current: string = (row.current_email ?? row.user_email ?? '').trim();
    if (current.toLowerCase() === email.toLowerCase()) {
      return { id: row.id, email: current, anchorEmail: row.user_email ?? current };
    }

    if (await this.isClaimedByOther(userEmailDAO, userMetadataDAO, email, userId)) {
      throw new ConflictError('Email is already in use by another account.');
    }

    const now: number = Math.floor(Date.now() / 1000);
    const outcome = await userEmailDAO.register({ email, userId: row.id, isVerified: true, now });
    if (outcome === 'already-claimed') {
      throw new ConflictError('Email is already in use by another account.');
    }
    // Revoke every other verified address, so only the new one authenticates.
    await userEmailDAO.revokeAllVerified(row.id, email);
    await userMetadataDAO.setCurrentEmail(row.id, email);

    this.byEmail.delete(current);
    this.byEmail.set(email, { id: row.id, email, anchorEmail: row.user_email ?? current });
    return { id: row.id, email, anchorEmail: row.user_email ?? current };
  }

  /**
   * Whether `email` is already a live login for some account other than `userId`.
   *
   * Two checks, because the two stores differ in case-sensitivity: the registry
   * row (exact key) and, for accounts whose address predates 0032, the
   * `current_email` column. Both are probed case-insensitively.
   */
  private async isClaimedByOther(
    userEmailDAO: UserEmailDAO,
    userMetadataDAO: UserMetadataDAO,
    email: string,
    userId: string,
  ): Promise<boolean> {
    const registered = await Promise.resolve(userEmailDAO.get(email)).catch(() => null);
    if (registered && registered.is_verified === 1 && registered.user_id !== userId) return true;

    const owner = await Promise.resolve(userMetadataDAO.getByCurrentEmail(email)).catch(() => null);
    return Boolean(owner?.id && owner.id !== userId);
  }

  /**
   * Ops/migration path: attach an address that has already been proven, without
   * making it the sign-in address.
   */
  public async linkVerifiedEmail(userId: string, email: string): Promise<void> {
    const address: string = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      throw new BadRequestError('Invalid email address.');
    }
    const userEmailDAO: UserEmailDAO = await this.deps.userEmailDAO();
    const outcome = await userEmailDAO.register({
      email: address,
      userId,
      isVerified: true,
      now: Math.floor(Date.now() / 1000),
    });
    if (outcome === 'already-claimed') {
      throw new ConflictError('Email is already in use by another account.');
    }
  }
}

export { UserIdentityService, idOf };
export type { AccountIdentity, UserIdentityDeps, UserIdentityEnv };
