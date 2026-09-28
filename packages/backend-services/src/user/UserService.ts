import { AssumableRolesDAO, AwsAccountsDAO, UserFavoriteAccountsDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import type { AssumableRoleOwner } from '@aws-access-bridge/backend-data/dao';

import type { AssumableAccountsMap, AssumableAccountsResponse } from '@aws-access-bridge/shared/model';
import { LocaleUtil } from '@aws-access-bridge/shared/utils';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService, idOf } from '../identity/UserIdentityService';

type UserServiceEnv = ServiceEnv;

interface CurrentUser {
  email: string;
  isSuperAdmin: boolean;
  preferredLanguage: string | null;
}

interface AssumableListOptions {
  showHidden?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Profile, favourites, hidden roles, and the assumables list.
 *
 * Every method takes the caller's sign-in ADDRESS and resolves it to an account
 * internally, rather than taking an id. That is deliberate: the authenticated
 * principal at the edge is always an address, and the point of migration 0032 is
 * that the address stops being the identity — so the address is the input and
 * the id is an implementation detail of the reads below. It also means the route
 * layer, the OpenAPI document, and the web client are all unaffected.
 */
class UserService {
  private readonly identity: UserIdentityService;

  constructor(
    private readonly env: UserServiceEnv,
    identity?: UserIdentityService,
  ) {
    this.identity = identity ?? new UserIdentityService(env);
  }

  public async getCurrentUser(userEmail: string): Promise<CurrentUser> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);

    const account = await this.identity.resolveAccount(userEmail);
    // Provision against the anchor, not the presented address: the account row
    // is keyed on the frozen anchor, and writing the current address here would
    // fork a second account the moment the two differ.
    const provisioningKey: string = account?.anchorEmail ?? userEmail;

    const [, isSuperAdmin, storedLanguage]: [void, boolean, string | null] = await Promise.all([
      userMetadataDAO.ensureUserEmailExists(provisioningKey),
      userMetadataDAO.isSuperAdmin(provisioningKey),
      userMetadataDAO.getPreferredLanguage(provisioningKey),
    ]);

    const preferredLanguage = storedLanguage ? LocaleUtil.normalize(storedLanguage) : null;
    return { email: account?.email ?? userEmail, isSuperAdmin, preferredLanguage };
  }

  public async updatePreferredLanguage(userEmail: string, preferredLanguage: string | null): Promise<string | null> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);
    const provisioningKey: string = account?.anchorEmail ?? userEmail;
    await userMetadataDAO.ensureUserEmailExists(provisioningKey);
    const trimmed = preferredLanguage?.trim() || null;
    const normalized: string | null = trimmed ? LocaleUtil.normalize(trimmed) : null;
    await userMetadataDAO.updatePreferredLanguage(provisioningKey, normalized);
    return normalized;
  }

  public async isSuperAdmin(userEmail: string): Promise<boolean> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);
    return userMetadataDAO.isSuperAdmin(account?.anchorEmail ?? userEmail);
  }

  public async favoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const favoritesDAO: UserFavoriteAccountsDAO = new UserFavoriteAccountsDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);

    await accountsDAO.ensureAccountExists(awsAccountId);
    await favoritesDAO.favoriteAccount(account?.anchorEmail ?? userEmail, awsAccountId, idOf(account));
  }

  public async unfavoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const favoritesDAO: UserFavoriteAccountsDAO = new UserFavoriteAccountsDAO(this.env.AccessBridgeDB);
    const account = await this.identity.resolveAccount(userEmail);
    await favoritesDAO.unfavoriteAccount(account?.anchorEmail ?? userEmail, awsAccountId, idOf(account));
  }

  public async hideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const owner = await this.ownerFor(userEmail);
    await rolesDAO.verifyUserHasAccessToRole(owner, awsAccountId, roleName);
    await rolesDAO.hideRole(owner, awsAccountId, roleName);
  }

  public async unhideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const owner = await this.ownerFor(userEmail);
    await rolesDAO.verifyUserHasAccessToRole(owner, awsAccountId, roleName);
    await rolesDAO.unhideRole(owner, awsAccountId, roleName);
  }

  public async listAssumables(userEmail: string, options: AssumableListOptions = {}): Promise<AssumableAccountsResponse> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const showHidden: boolean = options.showHidden ?? false;
    const limit: number = options.limit ?? 50;
    const offset: number = options.offset ?? 0;
    const owner = await this.ownerFor(userEmail);
    const totalAccounts: number = await assumableRolesDAO.getTotalAccountsCount(owner, showHidden);
    const assumableAccountsMap: AssumableAccountsMap = await assumableRolesDAO.getAllRolesByOwner(owner, showHidden, limit, offset);
    return { ...assumableAccountsMap, totalAccounts };
  }

  public async searchAccounts(userEmail: string, query: string, showHidden: boolean = false): Promise<AssumableAccountsMap> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const owner = await this.ownerFor(userEmail);
    return assumableRolesDAO.searchAccountsByQuery(owner, query.trim(), showHidden);
  }

  /**
   * The id-keyed read target for `assumable_roles`.
   *
   * An unresolvable address still yields an owner — with a null id — so an
   * unknown actor reads as "no rows" rather than erroring, which is how a deleted
   * or pre-0032 account keeps rendering as itself.
   */
  private async ownerFor(userEmail: string): Promise<AssumableRoleOwner> {
    const account = await this.identity.resolveAccount(userEmail);
    return { userId: idOf(account), anchorEmail: account?.anchorEmail ?? userEmail };
  }
}
export { UserService };
export type { AssumableListOptions, CurrentUser, UserServiceEnv };
