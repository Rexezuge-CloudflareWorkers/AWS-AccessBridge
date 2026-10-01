import { UserEmailDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import { isMissingSchemaError } from '@aws-access-bridge/backend-data/utils';
import { BadRequestError, ConflictError } from '@aws-access-bridge/backend-errors';
import type { AccountIdentity } from './UserIdentityService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

/**
 * Address registry operations: listing an account's addresses, and moving an
 * account to a new sign-in address.
 *
 * Split out of `UserIdentityService`, which resolves *who* a caller is. Address
 * management is a separate concern with a separate safety argument — it is the
 * only place an account can change identity, so its ordering and claim checks read
 * better isolated than interleaved with resolution. The resolver composes this
 * service, so callers still see one object.
 */
class AddressRegistryService {
  constructor(
    private readonly userEmailDAO: () => Promise<UserEmailDAO>,
    private readonly userMetadataDAO: () => Promise<UserMetadataDAO>,
  ) {}

  /**
  Every address known for an account, verified ones first.
  */
  public async listAddresses(userId: string): Promise<Array<{ email: string; isVerified: boolean }>> {
    const dao: UserEmailDAO = await this.userEmailDAO();
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
   * `scripts/ops/change-email.ts` applies the same sequence out of band.
   */
  public async setPrimaryEmail(userId: string, newEmail: string): Promise<AccountIdentity> {
    const email: string = newEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestError('Invalid email address.');
    }
    const userMetadataDAO: UserMetadataDAO = await this.userMetadataDAO();
    const userEmailDAO: UserEmailDAO = await this.userEmailDAO();
    const row = await userMetadataDAO.getById(userId);
    if (!row?.id) throw new BadRequestError('User not found.');

    const current: string = (row.current_email ?? row.user_email ?? '').trim();
    if (current.toLowerCase() === email.toLowerCase()) {
      return { id: row.id, email: current, anchorEmail: row.user_email ?? current };
    }

    if (await this.isClaimedByOther(userEmailDAO, userMetadataDAO, email, row.id)) {
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

    return { id: row.id, email, anchorEmail: row.user_email ?? current };
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
    const userEmailDAO: UserEmailDAO = await this.userEmailDAO();
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

  /**
   * Whether `email` is already a live login for some account other than `userId`.
   *
   * Two checks, because the two stores differ in case-sensitivity: the registry
   * row (exact key) and, for accounts whose address predates 0032, the
   * `current_email` column. Both are probed case-insensitively.
   *
   * Propagates anything but a missing 0032 schema, deliberately. This is the guard
   * that stops `setPrimaryEmail` claiming an address already live for a different
   * account; treating a failed lookup as "not claimed" turns a D1 blip into an
   * identity takeover.
   */
  private async isClaimedByOther(
    userEmailDAO: UserEmailDAO,
    userMetadataDAO: UserMetadataDAO,
    email: string,
    userId: string,
  ): Promise<boolean> {
    const registered = await Promise.resolve(userEmailDAO.get(email)).catch((error: unknown) => {
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    if (registered && registered.is_verified === 1 && registered.user_id !== userId) return true;

    const owner = await Promise.resolve(userMetadataDAO.getByCurrentEmail(email)).catch((error: unknown) => {
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    return Boolean(owner?.id && owner.id !== userId);
  }
}

export { AddressRegistryService };