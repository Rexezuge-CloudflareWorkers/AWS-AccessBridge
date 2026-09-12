import { AssumableRolesDAO, RoleConfigsDAO, UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { AccessKeysWithExpiration, CredentialCache, CredentialChain, RoleConfig } from '@aws-access-bridge/shared/model';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { INTERMEDIATE_ROLE_SESSION_NAME, ROLE_SESSION_NAME_PREFIX } from '@aws-access-bridge/shared/constants';
import { TimestampUtil } from '@aws-access-bridge/shared/utils';
import { ArnUtil } from '../ArnUtil';
import { StsService } from '../sts';
import { CredentialService, type CredentialServiceEnv } from '../../credential';

interface AssumeRoleServiceEnv extends CredentialServiceEnv {
  AccessBridgeDB: D1Queryable;
  AccessBridgeKV: KVNamespace;
}

class AssumeRoleService {
  private readonly credentials: CredentialService;
  private readonly sts: StsService;

  constructor(
    private readonly env: AssumeRoleServiceEnv,
    sts?: StsService,
    credentials?: CredentialService,
  ) {
    this.sts = sts ?? new StsService();
    this.credentials = credentials ?? new CredentialService(env, this.sts);
  }

  public async assumeRoleForUser(userEmail: string, principalArn: string): Promise<AccessKeysWithExpiration> {
    if (!principalArn) {
      throw new BadRequestError('Missing required fields.');
    }
    const accountId: string = ArnUtil.getAccountIdFromArn(principalArn);
    const roleName: string = ArnUtil.getRoleNameFromArn(principalArn);

    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    await assumableRolesDAO.verifyUserHasAccessToRole(userEmail, accountId, roleName);
    const roleConfigsDAO: RoleConfigsDAO = new RoleConfigsDAO(this.env.AccessBridgeDB);
    const roleConfig: RoleConfig | undefined = await roleConfigsDAO.getRoleConfig(accountId, roleName);

    const credentialChain: CredentialChain = await this.credentials.getCredentialChainToFirstCachedPrincipal(principalArn);

    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(this.env.AccessBridgeDB);
    const userId: string = await userMetadataDAO.getOrCreateFederationUsername(userEmail);

    const cacheDAO = await this.credentials.createCacheDAO();
    const { startIndex, credentials } = await this.findClosestCachedCredential(cacheDAO, credentialChain);

    return this.assumeRoleChain(cacheDAO, credentialChain, startIndex, credentials, userId, roleConfig?.roleSessionDurationSeconds);
  }

  /**
   * Finds the closest cached credential to the target role in the credential chain.
   * Searches from index 1 (first intermediate role) towards the base IAM user to find
   * the most recent cached intermediate credential that can be reused.
   */
  public async findClosestCachedCredential(
    credentialsCacheDAO: { getCachedCredential(principalArn: string): Promise<CredentialCache | undefined> },
    credentialChain: CredentialChain,
  ): Promise<{ startIndex: number; credentials: AccessKeysWithExpiration }> {
    let startIndex: number = credentialChain.principalArns.length - 2;
    let credentials: AccessKeysWithExpiration = {
      accessKeyId: credentialChain.accessKeyId,
      secretAccessKey: credentialChain.secretAccessKey,
    };
    // Check cache from first intermediate role towards base IAM user to find closest cached credential
    for (let i: number = 1; i < credentialChain.principalArns.length; ++i) {
      const cachedCredential: CredentialCache | undefined = await credentialsCacheDAO.getCachedCredential(credentialChain.principalArns[i]);
      if (cachedCredential) {
        startIndex = i - 1; // Start assuming from the role before the cached one (closer to target)
        credentials = {
          accessKeyId: cachedCredential.accessKeyId,
          secretAccessKey: cachedCredential.secretAccessKey,
          sessionToken: cachedCredential.sessionToken,
        };
        break;
      }
    }
    return { startIndex, credentials };
  }

  /**
   * Assumes roles in the credential chain starting from the given index and working towards the target role.
   * Iterates from startIndex down to 0 (target role), caching intermediate role credentials for future use.
   * Only caches intermediate roles (i > 0), excluding both the target role and base IAM user credentials.
   */
  public async assumeRoleChain(
    credentialsCacheDAO: {
      storeCachedCredential(cache: CredentialCache): Promise<unknown>;
    },
    credentialChain: CredentialChain,
    startIndex: number,
    credentials: AccessKeysWithExpiration,
    userId: string,
    roleSessionDurationSeconds?: number,
  ): Promise<AccessKeysWithExpiration> {
    let newCredentials: AccessKeysWithExpiration = credentials;
    for (let i = startIndex; i >= 0; --i) {
      const roleArn: string = credentialChain.principalArns[i];
      const sessionName: string = i > 0 ? INTERMEDIATE_ROLE_SESSION_NAME : `${ROLE_SESSION_NAME_PREFIX}${userId}`;
      const durationSeconds: number | undefined = i === 0 ? roleSessionDurationSeconds : undefined;
      newCredentials = await this.sts.assumeRole(roleArn, newCredentials, sessionName, durationSeconds);
      // Cache intermediate credentials (not target role, not base IAM user)
      if (i > 0 && newCredentials.expiration) {
        await credentialsCacheDAO.storeCachedCredential({
          principalArn: roleArn,
          accessKeyId: newCredentials.accessKeyId,
          secretAccessKey: newCredentials.secretAccessKey,
          sessionToken: newCredentials.sessionToken!,
          expiresAt: TimestampUtil.convertIsoToUnixTimestampInSeconds(newCredentials.expiration),
        });
      }
    }
    return newCredentials;
  }
}

class AssumeRoleServiceFactory {
  public static create(env: AssumeRoleServiceEnv): AssumeRoleService {
    return new AssumeRoleService(env);
  }
}

export { AssumeRoleService, AssumeRoleServiceFactory };
export type { AssumeRoleServiceEnv };
