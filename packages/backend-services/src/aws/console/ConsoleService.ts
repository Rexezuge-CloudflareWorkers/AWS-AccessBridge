import { InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { FetchHttpClient, type IHttpClient } from '../../http';

class ConsoleService {
  private readonly http: IHttpClient;

  constructor(http: IHttpClient = new FetchHttpClient()) {
    this.http = http;
  }

  public async getSigninToken(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<string> {
    const session: SessionCredentials = {
      sessionId: accessKeyId,
      sessionKey: secretAccessKey,
      sessionToken: sessionToken,
    };
    const sessionJson: string = JSON.stringify(session);
    const sessionEncoded: string = encodeURIComponent(sessionJson);
    const url: string = `https://signin.aws.amazon.com/federation?Action=getSigninToken&SessionType=json&Session=${sessionEncoded}`;
    const response: Response = await this.http.fetch(url);
    if (response.ok) {
      // Guarded: a malformed body would otherwise throw a raw `SyntaxError`,
      // bypassing the `IServiceError` taxonomy and the typed status mapping.
      let data: SigninResponse;
      try {
        data = (await response.json());
      } catch (error: unknown) {
        throw new InternalServerError(`AWS returned a malformed signin token response: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      if (!data?.SigninToken) {
        throw new InternalServerError('AWS returned a signin token response with no SigninToken.');
      }
      return data.SigninToken;
    }
    if (response.status === 400) {
      throw new UnauthorizedError('AWS access credentials are not valid.');
    }
    throw new InternalServerError(`Failed to get signin token from AWS: ${response.status}`);
  }

  public getLoginUrl(signinToken: string, issuer: string, destination = 'https://console.aws.amazon.com/'): string {
    const params: URLSearchParams = new URLSearchParams({
      Action: 'login',
      Issuer: issuer,
      Destination: destination,
      SigninToken: signinToken,
    });

    return `https://signin.aws.amazon.com/federation?${params.toString()}`;
  }

  /**
 * The console URL to land on, with the region applied when one is configured.
 *
 * `destinationPath` is concatenated, not fed to `new URL(path, base)`: AWS
 * console paths are not relative references, so the base's origin and any
 * existing query would be discarded or reinterpreted.
 */
public buildDestination(destinationPath?: string, destinationRegion?: string): string {
    let destination: string = destinationPath ? `https://console.aws.amazon.com/${destinationPath}` : 'https://console.aws.amazon.com/';
    if (destinationRegion) {
      const url: URL = new URL(destination);
      url.searchParams.set('region', destinationRegion);
      destination = url.href;
    }
    return destination;
  }

  /**
 * The federation `Issuer`, which AWS echoes back into the console URL.
 *
 * Built with `URLSearchParams` because `roleName` is only constrained to a
 * non-empty 128-character string — it comes from the `role` query parameter on
 * `/user/aws/federate`. Interpolated raw, a `&` or `#` in it injected extra
 * parameters into the issuer AWS is asked to trust.
 */
public buildIssuerUrl(baseUrl: string, awsAccountId?: string, roleName?: string): string {
    if (!awsAccountId || !roleName) {
      return baseUrl;
    }
    const params: URLSearchParams = new URLSearchParams({ awsAccountId, role: roleName });
    return `${baseUrl}/user/aws/federate?${params.toString()}`;
  }
}

interface SessionCredentials {
  sessionId: string;
  sessionKey: string;
  sessionToken?: string;
}

interface SigninResponse {
  SigninToken: string;
  Expiration: string;
}

export { ConsoleService };
