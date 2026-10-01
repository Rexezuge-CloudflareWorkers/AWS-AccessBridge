import { idOf } from './UserIdentityService';
import type { UserIdentityService } from './UserIdentityService';

/**
 * The `owner` every user-keyed DAO read and write is matched against.
 *
 * `userId` is the stable account id (migration 0032) and `anchorEmail` the
 * account's frozen anchor — the value the legacy `*_email` columns and their
 * foreign keys hold. Both are needed: the id arm makes a grant survive an address
 * change, the anchor arm keeps rows the 0032 backfill could not attribute
 * visible.
 */
interface Owner {
  userId: string | null;
  anchorEmail: string;
}

/**
 * Resolve a caller's sign-in address into the `owner` its DAO statements are keyed
 * on.
 *
 * An unresolvable address still yields an owner — with a null id — so an unknown
 * actor reads as "no accounts" rather than erroring. That is deliberate: a 404 on
 * an unknown caller would turn the address space into an account-enumeration
 * oracle.
 *
 * This is the single definition of the translation. It was previously written out
 * fifteen times across seven services, each with its own copy of the
 * `idOf(account) ?? null` / `account?.anchorEmail ?? userEmail` pair, so a change to
 * either half had to be made fifteen times — and `AccessService` and
 * `AssumeRoleService` had inlined it at their call sites instead of using a
 * helper at all.
 */
async function resolveOwner(identity: UserIdentityService, userEmail: string): Promise<Owner> {
  const account = await identity.resolveAccount(userEmail);
  return { userId: idOf(account), anchorEmail: account?.anchorEmail ?? userEmail };
}

export { resolveOwner };
export type { Owner };