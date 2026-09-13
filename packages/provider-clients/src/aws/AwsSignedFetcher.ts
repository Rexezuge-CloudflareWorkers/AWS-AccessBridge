import { AwsClient } from 'aws4fetch';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

interface AwsClientOptions {
  service: string;
  region: string;
  keys: AccessKeys;
}

interface AwsSignedClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

type AwsClientFactory = (options: AwsClientOptions) => AwsSignedClient;

function defaultAwsClientFactory(options: AwsClientOptions): AwsSignedClient {
  return new AwsClient({
    service: options.service,
    region: options.region,
    accessKeyId: options.keys.accessKeyId,
    secretAccessKey: options.keys.secretAccessKey,
    sessionToken: options.keys.sessionToken,
  });
}

/**
 * Extracts the first `<Tag>value</Tag>` occurrence from an AWS XML response.
 * Shared by STS/CE/IAM parsers (previously 3× inline regex).
 */
function parseXmlTag(xml: string, tag: string): string | undefined {
  const match: RegExpMatchArray | null = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  return match?.[1];
}

export { defaultAwsClientFactory, parseXmlTag };
export type { AwsClientFactory, AwsClientOptions, AwsSignedClient };
