import { AssumableRolesDAO, AwsAccountsDAO, UserFavoriteAccountsDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AssumableAccountsMap, AssumableAccountsResponse } from '@aws-access-bridge/shared/model';

interface UserServiceEnv {
  AccessBridgeDB: D1Queryable;
}

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

class UserService {
  constructor(private readonly env: UserServiceEnv) {}

  public async getCurrentUser(userEmail: string): Promise<CurrentUser> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);

    const [, isSuperAdmin, preferredLanguage]: [void, boolean, string | null] = await Promise.all([
      userMetadataDAO.ensureUserEmailExists(userEmail),
      userMetadataDAO.isSuperAdmin(userEmail),
      userMetadataDAO.getPreferredLanguage(userEmail),
    ]);

    return { email: userEmail, isSuperAdmin, preferredLanguage };
  }

  public async updatePreferredLanguage(userEmail: string, preferredLanguage: string | null): Promise<string | null> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);
    await userMetadataDAO.ensureUserEmailExists(userEmail);
    const normalized: string | null = preferredLanguage?.trim() || null;
    await userMetadataDAO.updatePreferredLanguage(userEmail, normalized);
    return normalized;
  }

  public async isSuperAdmin(userEmail: string): Promise<boolean> {
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);
    return userMetadataDAO.isSuperAdmin(userEmail);
  }

  public async favoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const favoritesDAO: UserFavoriteAccountsDAO = new UserFavoriteAccountsDAO(this.env.AccessBridgeDB);
    const accountsDAO: AwsAccountsDAO = new AwsAccountsDAO(this.env.AccessBridgeDB);

    await accountsDAO.ensureAccountExists(awsAccountId);
    await favoritesDAO.favoriteAccount(userEmail, awsAccountId);
  }

  public async unfavoriteAccount(userEmail: string, awsAccountId: string): Promise<void> {
    const favoritesDAO: UserFavoriteAccountsDAO = new UserFavoriteAccountsDAO(this.env.AccessBridgeDB);
    await favoritesDAO.unfavoriteAccount(userEmail, awsAccountId);
  }

  public async hideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    await rolesDAO.verifyUserHasAccessToRole(userEmail, awsAccountId, roleName);
    await rolesDAO.hideRole(userEmail, awsAccountId, roleName);
  }

  public async unhideRole(userEmail: string, awsAccountId: string, roleName: string): Promise<void> {
    const rolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    await rolesDAO.verifyUserHasAccessToRole(userEmail, awsAccountId, roleName);
    await rolesDAO.unhideRole(userEmail, awsAccountId, roleName);
  }

  public async listAssumables(userEmail: string, options: AssumableListOptions = {}): Promise<AssumableAccountsResponse> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const showHidden: boolean = options.showHidden ?? false;
    const limit: number = options.limit ?? 50;
    const offset: number = options.offset ?? 0;
    const totalAccounts: number = await assumableRolesDAO.getTotalAccountsCount(userEmail, showHidden);
    const assumableAccountsMap: AssumableAccountsMap = await assumableRolesDAO.getAllRolesByUserEmail(userEmail, showHidden, limit, offset);
    return { ...assumableAccountsMap, totalAccounts };
  }

  public async searchAccounts(userEmail: string, query: string, showHidden: boolean = false): Promise<AssumableAccountsMap> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    return assumableRolesDAO.searchAccountsByQuery(userEmail, query.trim(), showHidden);
  }
}

class UserServiceFactory {
  public static create(env: UserServiceEnv): UserService {
    return new UserService(env);
  }
}

export { UserService, UserServiceFactory };
export type { AssumableListOptions, CurrentUser, UserServiceEnv };
