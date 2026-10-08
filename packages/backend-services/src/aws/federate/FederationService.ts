import type { AssumeRoleService } from '../assume-role/AssumeRoleService';
import type { ConsoleService } from '../console/ConsoleService';

/**
 * Console federation in one call.
 *
 * `/api/aws/federate` used to call its own assume-role and console routes over
 * HMAC-signed loopback fetches. Besides the extra request hop, that serialized
 * the temporary credentials through the network stack, re-ran the auth and
 * audit middleware, and produced two extra audit entries — one federation
 * surfaced as three. In-process composition keeps the same policy (the access
 * check still runs inside `AssumeRoleService.assumeRoleForUser`) with one
 * audit event and none of the body handling.
 */
class FederationService {
  constructor(
    private readonly assumeRole: AssumeRoleService,
    private readonly console: ConsoleService,
  ) {}

  public async generateConsoleUrlForUser(
    userEmail: string,
    principalArn: string,
    baseUrl: string,
    awsAccountId: string | undefined,
    roleName: string | undefined,
    destinationPath?: string,
    destinationRegion?: string,
  ): Promise<string> {
    const credentials = await this.assumeRole.assumeRoleForUser(userEmail, principalArn);
    const signinToken: string = await this.console.getSigninToken(credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken);
    const issuer: string = this.console.buildIssuerUrl(baseUrl, awsAccountId, roleName);
    const destination: string = this.console.buildDestination(destinationPath, destinationRegion);
    return this.console.getLoginUrl(signinToken, issuer, destination);
  }
}

export { FederationService };
