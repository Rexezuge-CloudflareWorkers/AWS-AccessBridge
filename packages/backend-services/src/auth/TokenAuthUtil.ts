import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao';
import { UserAccessTokenMetadata } from '@aws-access-bridge/shared/model/UserAccessToken';

class TokenAuthUtil {
  public static async authenticateWithPAT(token: string, database: D1Database | D1DatabaseSession): Promise<string> {
    const userAccessTokenDAO: UserAccessTokenDAO = new UserAccessTokenDAO(database);
    const tokenData: UserAccessTokenMetadata | undefined = await userAccessTokenDAO.getByToken(token, true);
    if (tokenData) {
      await userAccessTokenDAO.updateLastUsedByToken(token);
      return tokenData.userEmail;
    }
    throw new UnauthorizedError('Your access could not be authorized because your personal access token is invalid or has expired.');
  }
}

export { TokenAuthUtil };
