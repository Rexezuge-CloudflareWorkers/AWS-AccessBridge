import type { AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { BadRequestError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { ASSUME_ROLE_UTIL_ERROR_STS_CALL, ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE } from '@aws-access-bridge/shared/constants';
import type { AwsClientFactory } from './AwsSignedFetcher';
import { defaultAwsClientFactory, parseXmlTag } from './AwsSignedFetcher';

interface CallerIdentity {
  arn: string;
  accountId: string;
  userId: string;
}

/**
 * Raw AWS STS client (Layer 2, provider-clients). Owns signed-fetch +
 * XML parsing. Domain orchestration (chains, caching) stays in
 * `backend-services` `StsService` which delegates here.
 */
class StsClient {
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async assumeRole(
    roleArn: string,
    accessKeys: AccessKeys,
    sessionName: string,
    durationSeconds?: number,
    region = 'us-east-1',
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

    const accessKeyId = parseXmlTag(xmlText, 'AccessKeyId');
    const secretAccessKey = parseXmlTag(xmlText, 'SecretAccessKey');
    const sessionToken = parseXmlTag(xmlText, 'SessionToken');
    const expiration = parseXmlTag(xmlText, 'Expiration');

    if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) {
      throw new InternalServerError(ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE);
    }

    return { accessKeyId, secretAccessKey, sessionToken, expiration };
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

    const arn = parseXmlTag(xmlText, 'Arn');
    const accountId = parseXmlTag(xmlText, 'Account');
    const userId = parseXmlTag(xmlText, 'UserId');

    if (!arn || !accountId || !userId) {
      throw new InternalServerError('Failed to parse STS GetCallerIdentity response.');
    }

    return { arn, accountId, userId };
  }
}

export { StsClient };
export type { CallerIdentity };
