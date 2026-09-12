import { UnauthorizedError, InternalServerError } from '@aws-access-bridge/backend-errors';

class AwsConsoleUtil {
  public static async getSigninToken(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<string> {
    const session: SessionCredentials = {
      sessionId: accessKeyId,
      sessionKey: secretAccessKey,
      sessionToken: sessionToken,
    };
    const sessionJson: string = JSON.stringify(session);
    const sessionEncoded: string = encodeURIComponent(sessionJson);
    const url: string = `https://signin.aws.amazon.com/federation?Action=getSigninToken&SessionType=json&Session=${sessionEncoded}`;
    const response: Response = await fetch(url);
    if (response.ok) {
      const data: SigninResponse = await response.json();
      return data.SigninToken;
    }
    if (response.status === 400) {
      throw new UnauthorizedError('AWS access credentials are not valid.');
    }
    throw new InternalServerError(`Failed to get signin token from AWS: ${response.status}`);
  }

  public static getLoginUrl(signinToken: string, issuer: string, destination = 'https://console.aws.amazon.com/'): string {
    const params: URLSearchParams = new URLSearchParams({
      Action: 'login',
      Issuer: issuer,
      Destination: destination,
      SigninToken: signinToken,
    });

    return `https://signin.aws.amazon.com/federation?${params.toString()}`;
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

export { AwsConsoleUtil };
