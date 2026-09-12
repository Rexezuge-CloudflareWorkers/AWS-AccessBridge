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
      const data: SigninResponse = await response.json();
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

  public buildDestination(destinationPath?: string, destinationRegion?: string): string {
    let destination: string = destinationPath ? `https://console.aws.amazon.com/${destinationPath}` : 'https://console.aws.amazon.com/';
    if (destinationRegion) {
      const url: URL = new URL(destination);
      url.searchParams.set('region', destinationRegion);
      destination = url.href;
    }
    return destination;
  }

  public buildIssuerUrl(baseUrl: string, awsAccountId?: string, roleName?: string): string {
    if (awsAccountId && roleName) {
      return `${baseUrl}/user/aws/federate?awsAccountId=${awsAccountId}&role=${roleName}`;
    }
    return baseUrl;
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
