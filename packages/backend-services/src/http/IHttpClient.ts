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
    throw new HttpFetchError(200, 'Malformed JSON', `${url} returned a body that is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`, {
      retryable: false,
    });
  }
}

class FetchHttpClient implements IHttpClient {
  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  public async fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const response: Response = await fetch(url, init);
    const text: string = await response.text();
    if (!response.ok) {
      throw new HttpFetchError(response.status, response.statusText, text);
    }
    return parseJsonBody(text, url);
  }
}

export { FetchHttpClient, parseJsonBody };
export type { IHttpClient };