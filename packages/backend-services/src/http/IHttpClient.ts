import { DEFAULT_AWS_FETCH_TIMEOUT_MS, fetchWithTimeout } from '@aws-access-bridge/provider-clients/aws';
import { toErrorMessage } from '@aws-access-bridge/shared/utils';
import { HttpFetchError } from './HttpFetchError';

interface IHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  fetchJson(url: string, init?: RequestInit): Promise<unknown>;
}

/**
 * Parse a JSON body, reporting a malformed one as an `HttpFetchError`.
 *
 * A bare `JSON.parse` here threw a raw `SyntaxError`, which bypassed the
 * `IServiceError` taxonomy every caller maps status codes through.
 */
function parseJsonBody(text: string, url: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    // `retryable: false` is the load-bearing part. The status is 200, so the
    // status-derived verdict would be "not retryable" by accident — but the
    // reason it is not retryable is that we could not parse the body, and a
    // second identical request will not parse either.
    throw new HttpFetchError(200, 'Malformed JSON', `${url} returned a body that is not valid JSON: ${toErrorMessage(error)}`, {
      retryable: false,
    });
  }
}

/**
 * Plain `fetch` under a deadline.
 *
 * `fetch` has no timeout of its own, so an unresponsive endpoint (the AWS
 * federation signin, say) would hold the request — or the cron Durable Object's
 * run guard — open indefinitely. `timeoutMs` is injectable so a test can make
 * the deadline observable; expiry throws a retryable `BadGatewayError`.
 */
class FetchHttpClient implements IHttpClient {
  constructor(private readonly timeoutMs: number = DEFAULT_AWS_FETCH_TIMEOUT_MS) {}

  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetchWithTimeout((guarded: RequestInit) => fetch(url, guarded), init, new URL(url).host, this.timeoutMs);
  }

  public async fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const response: Response = await this.fetch(url, init);
    const text: string = await response.text();
    if (!response.ok) {
      throw new HttpFetchError(response.status, response.statusText, text);
    }
    return parseJsonBody(text, url);
  }
}

export { FetchHttpClient, parseJsonBody };
export type { IHttpClient };
