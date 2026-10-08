import { AwsClient } from 'aws4fetch';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { DEFAULT_AWS_FETCH_TIMEOUT_MS, fetchWithTimeout } from './FetchTimeout';

interface AwsClientOptions {
  service: string;
  region: string;
  keys: AccessKeys;
}

interface AwsSignedClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

type AwsClientFactory = (options: AwsClientOptions) => AwsSignedClient;

/**
 * A signed client whose every call runs under a deadline.
 *
 * The timeout lives here, around the signed `fetch`, rather than at each call
 * site: there are five collectors and three clients, and a deadline that has to
 * be remembered per caller is one a new caller forgets.
 */
class TimeoutAwsClient implements AwsSignedClient {
  constructor(
    private readonly inner: AwsSignedClient,
    private readonly timeoutMs: number,
  ) {}

  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetchWithTimeout((guarded: RequestInit) => this.inner.fetch(url, guarded), init, new URL(url).host, this.timeoutMs);
  }
}

/**
 * Build a factory whose clients time out after `timeoutMs`. The default factory
 * uses `DEFAULT_AWS_FETCH_TIMEOUT_MS`; tests inject a short one.
 */
function createAwsClientFactory(timeoutMs: number = DEFAULT_AWS_FETCH_TIMEOUT_MS): AwsClientFactory {
  return (options: AwsClientOptions): AwsSignedClient =>
    new TimeoutAwsClient(
      new AwsClient({
        service: options.service,
        region: options.region,
        accessKeyId: options.keys.accessKeyId,
        secretAccessKey: options.keys.secretAccessKey,
        sessionToken: options.keys.sessionToken,
      }),
      timeoutMs,
    );
}

const defaultAwsClientFactory: AwsClientFactory = createAwsClientFactory();

/**
 * Extracts the first `<Tag>value</Tag>` occurrence from an AWS XML response.
 * Shared by STS/CE/IAM parsers (previously 3× inline regex).
 */
function parseXmlTag(xml: string, tag: string): string | undefined {
  const match: RegExpMatchArray | null = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  return match?.[1];
}

/**
Content type AWS Query protocol expects when the parameters ride in the body.
*/
const AWS_QUERY_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

/**
 * The signed-fetch arguments for an AWS Query-protocol action.
 *
 * **The parameters go in the form-encoded body, never the query string.** AWS
 * accepts either placement, which is why the query-string form worked and looked
 * fine — but the body is the only placement the AWS SDKs themselves use, and it
 * is the only one LocalStack-compatible emulators read. Floci answers a
 * `POST /?Action=…` with `HTTP 204` and an empty body, which every caller here
 * reads as success (`204` is `response.ok`) and then fails on with a parse error
 * pointing at the response rather than at the request. An IAM `GET /?Action=…`
 * fares worse still: with no `Action` in the body, routing falls through to the
 * host default and S3 answers with `ListAllMyBucketsResult`.
 *
 * Every Query-protocol call goes through here so the placement is decided once.
 */
function awsQueryRequest(url: string, params: URLSearchParams): { url: string; init: RequestInit } {
  return {
    url,
    init: { method: 'POST', headers: { 'Content-Type': AWS_QUERY_FORM_CONTENT_TYPE }, body: params.toString() },
  };
}

export { awsQueryRequest, createAwsClientFactory, defaultAwsClientFactory, parseXmlTag, TimeoutAwsClient };
export type { AwsClientFactory, AwsClientOptions, AwsSignedClient };
