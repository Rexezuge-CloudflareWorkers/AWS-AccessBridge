import { UserEmailDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import { isMissingSchemaError } from '@aws-access-bridge/backend-data/utils';
import { isD1ErrorRetryable } from '@aws-access-bridge/backend-data/utils/D1ErrorClassifier';
import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { AddressRegistryService } from './AddressRegistryService';

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
 * Addresses are matched case-insensitively against the registry (the registry
 * lowercases its keys), so a mixed-case presentation of the same address
 * resolves to the same account. A pre-0032 mixed-case account (which has no
 * registry row) falls through to the `current_email` / anchor path and cannot
 * be steered into another account's. Case-insensitive equality is also
 * enforced when an address is claimed, in `setPrimaryEmail`.
 */
class UserIdentityService {
  private readonly deps: Required<UserIdentityDeps>;
  private readonly registry: AddressRegistryService;
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
    this.registry = new AddressRegistryService(this.deps.userEmailDAO, this.deps.userMetadataDAO);
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
      // Already classified by the DAO layer, so it passes through with its
      // `retryable` flag intact. A raw `Error` is classified here rather than
      // wrapped blind: a busy or throttled database is retryable, and dropping the
      // verdict means the retry policy treats it as permanent.
      throw error instanceof DatabaseError
        ? error
        : new DatabaseError(
            `Failed to resolve account: ${error instanceof Error ? error.message : String(error)}`,
            isD1ErrorRetryable(error instanceof Error ? error.message : String(error)),
          );
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
    // Addresses are matched case-INSENSITIVELY against the registry: the
    // registry stores normalized (lowercased) addresses, and Cloudflare Access
    // does not guarantee the casing of the sign-in address, so an exact match
    // would let `Alice@x.com` and `alice@x.com` resolve to two different
    // outcomes for the same account.
    const registered = await Promise.resolve(userEmailDAO.get(email.toLowerCase())).catch((error: unknown) => {
      // Registry absent on a database that has not run 0032. Not an outage.
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    if (registered) {
      return registered.is_verified === 1 ? await this.hydrate(registered.user_id) : null;
    }

    // No registry row. Migration 0032 backfilled a verified row for every
    // account that was assigned a `current_email`, so a row-less address is
    // either brand new, one of the ambiguous mixed-case stragglers that 0032
    // deliberately left with `current_email IS NULL`, or an address on a
    // pre-0032 database where the anchor *is* the identity. All three still
    // resolve, the last two through the anchor. A revoked address always has a
    // registry row and returned above.
    // Only a missing registry schema is tolerated. Swallowing a real D1 failure
    // here would return "no such account" for an account that exists, so every
    // service would read as empty — no assumables, no resources, not an
    // administrator — with no error anywhere.
    const byAnchor = await Promise.resolve(userMetadataDAO.getByCurrentEmail(email)).catch((error: unknown) => {
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
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
    // Same rule as `load`: only a pre-0032 database degrades to the anchor path,
    // an actual D1 failure propagates.
    const row = await Promise.resolve(dao.getByAnchor(email)).catch((error: unknown) => {
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    if (!row) return null;
    // A row whose mutable address has moved away from the anchor may not
    // authenticate through it: the anchor is frozen, and the registry is what
    // revokes it. Falling through would let a *revoked* address keep signing
    // in the account long after the account moved on. Rows whose anchor IS
    // their current address resolve exactly as before.
    if (row.current_email != null && row.current_email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return null;
    }
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
   * Address management, delegated to `AddressRegistryService`.
   *
   * Exposed here so callers keep resolving one identity object; the registry is a
   * separate class only because its safety argument is a different one from
   * resolution's.
   */

  /**
  Every address known for an account, verified ones first.
  */
  public async listAddresses(userId: string): Promise<Array<{ email: string; isVerified: boolean }>> {
    return this.registry.listAddresses(userId);
  }

  /**
  Point an account at a new sign-in address. See `AddressRegistryService`.
  */
  public async setPrimaryEmail(userId: string, newEmail: string): Promise<AccountIdentity> {
    const account: AccountIdentity = await this.registry.setPrimaryEmail(userId, newEmail);
    // The memoised resolution for the old address is now stale: it points at an
    // address that no longer authenticates. Drop it rather than let a second
    // resolution in this scope return the pre-change identity.
    this.byEmail.delete(account.anchorEmail);
    this.byEmail.set(account.email, account);
    return account;
  }

  /**
  Attach an already-proven address without making it the sign-in address.
  */
  public async linkVerifiedEmail(userId: string, email: string): Promise<void> {
    return this.registry.linkVerifiedEmail(userId, email);
  }
}

export { UserIdentityService, idOf };
export type { AccountIdentity, UserIdentityDeps, UserIdentityEnv };
