import { AwsClient } from 'aws4fetch';
import type { AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { BadRequestError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { ASSUME_ROLE_UTIL_ERROR_STS_CALL, ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE } from '@aws-access-bridge/backend-errors/constants';
import type { AwsClientFactory, AwsClientOptions } from '../../http';

function defaultAwsClientFactory(options: AwsClientOptions) {
  return new AwsClient({
    service: options.service,
    region: options.region,
    accessKeyId: options.keys.accessKeyId,
    secretAccessKey: options.keys.secretAccessKey,
    sessionToken: options.keys.sessionToken,
  });
}

interface CallerIdentity {
  arn: string;
  accountId: string;
  userId: string;
}

class StsService {
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async assumeRole(
    roleArn: string,
    accessKeys: AccessKeys,
    sessionName: string,
    durationSeconds?: number,
    region: string = 'us-east-1',
  ): Promise<AccessKeysWithExpiration> {
    const maxDurationSeconds: number = accessKeys.sessionToken ? 3600 : 43_200;
    const effectiveDurationSeconds: number = Math.min(durationSeconds ?? maxDurationSeconds, maxDurationSeconds);
    const stsClient = this.clientFactory({ service: 'sts', region, keys: accessKeys });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'AssumeRole',
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      DurationSeconds: effectiveDurationSeconds.toString(),
      Version: '2011-06-15',
    });

    const url: string = `https://sts.${region}.amazonaws.com/?${queryParams.toString()}`;

    const response: Response = await stsClient.fetch(url, { method: 'POST' });
    const xmlText: string = await response.text();

    if (!response.ok) {
      console.error(`STS AssumeRole failed: ${response.status} ${response.statusText}\n${xmlText}`);
      throw new UnauthorizedError(ASSUME_ROLE_UTIL_ERROR_STS_CALL);
    }

    const accessKeyIdMatch: RegExpMatchArray | null = /<AccessKeyId>([^<]+)<\/AccessKeyId>/.exec(xmlText);
    const secretAccessKeyMatch: RegExpMatchArray | null = /<SecretAccessKey>([^<]+)<\/SecretAccessKey>/.exec(xmlText);
    const sessionTokenMatch: RegExpMatchArray | null = /<SessionToken>([^<]+)<\/SessionToken>/.exec(xmlText);
    const expirationMatch: RegExpMatchArray | null = /<Expiration>([^<]+)<\/Expiration>/.exec(xmlText);

    if (!accessKeyIdMatch || !secretAccessKeyMatch || !sessionTokenMatch || !expirationMatch) {
      throw new InternalServerError(ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE);
    }

    return {
      accessKeyId: accessKeyIdMatch[1],
      secretAccessKey: secretAccessKeyMatch[1],
      sessionToken: sessionTokenMatch[1],
      expiration: expirationMatch[1],
    };
  }

  public async validateCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<CallerIdentity> {
    const stsClient = this.clientFactory({
      service: 'sts',
      region: 'us-east-1',
      keys: { accessKeyId, secretAccessKey, sessionToken },
    });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
    });

    const url: string = `https://sts.us-east-1.amazonaws.com/?${queryParams.toString()}`;
    const response: Response = await stsClient.fetch(url, { method: 'POST' });
    const xmlText: string = await response.text();

    if (!response.ok) {
      throw new BadRequestError(`AWS credentials are invalid: ${response.status} ${response.statusText}`);
    }

    const arnMatch: RegExpMatchArray | null = /<Arn>([^<]+)<\/Arn>/.exec(xmlText);
    const accountMatch: RegExpMatchArray | null = /<Account>([^<]+)<\/Account>/.exec(xmlText);
    const userIdMatch: RegExpMatchArray | null = /<UserId>([^<]+)<\/UserId>/.exec(xmlText);

    if (!arnMatch || !accountMatch || !userIdMatch) {
      throw new InternalServerError('Failed to parse STS GetCallerIdentity response.');
    }

    return {
      arn: arnMatch[1],
      accountId: accountMatch[1],
      userId: userIdMatch[1],
    };
  }
}

export { StsService, defaultAwsClientFactory };
export type { CallerIdentity };
