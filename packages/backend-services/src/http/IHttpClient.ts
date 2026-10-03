interface IHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  fetchJson(url: string, init?: RequestInit): Promise<unknown>;
}

class HttpFetchError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`HTTP request failed (${status.toString()}): ${body || statusText}`);
    this.name = 'HttpFetchError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
429 and 5xx are worth another attempt; a 4xx will fail identically.
*/
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * An AWS client that retries a throttled or transiently-faulted call.
 *
 * Without it a single `Throttling` on one hop of a credential chain failed the
 * whole operation for the caller, even though the same request usually succeeds
 * immediately. Attempts are bounded and the delay is exponential with jitter:
 * without the jitter, every concurrent request retries in lockstep and
 * reproduces the burst that caused the throttle.
 *
 * `Retry-After` is honoured when AWS sends one, since it is the authoritative
 * backoff request.
 */
/**
 * Jitter source, injectable so the backoff is deterministically testable.
 * Backed by `crypto.getRandomValues` rather than `Math.random`: it only spreads
 * timing, and never decides access, retries, or any value that reaches a
 * response.
 */
type Jitter = (max: number) => number;

const cryptoJitter: Jitter = (max: number): number => {
  if (max <= 0) return 0;
  const buffer = new Uint32Array(new ArrayBuffer(4));
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
};

class RetryingAwsClient implements AwsSignedClient {
  constructor(
    private readonly inner: AwsSignedClient,
    private readonly maxAttempts: number = 3,
    private readonly baseDelayMs: number = 100,
    private readonly jitter: Jitter = cryptoJitter,
  ) {}

  public async fetch(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const response: Response = await this.inner.fetch(url, init);
        if (!isRetryableHttpStatus(response.status) || attempt === this.maxAttempts - 1) {
          return response;
        }
        await RetryingAwsClient.delay(this.backoffMs(attempt, response));
      } catch (error: unknown) {
        if (attempt === this.maxAttempts - 1) {
          throw error;
        }
        await RetryingAwsClient.delay(this.backoffMs(attempt));
      }
    }
    // Unreachable: the loop returns or throws on its final iteration. Present so
    // the signature has a total return type.
    throw new HttpFetchError(0, 'Retries exhausted', `Gave up after ${this.maxAttempts} attempts: ${url}`);
  }

  private backoffMs(attempt: number, response?: Response): number {
    const retryAfter: string | null = response?.headers.get('Retry-After') ?? null;
    const seconds: number = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    // Full jitter across the exponential window, so concurrent callers do not
    // retry in lockstep and reproduce the burst that caused the throttle.
    return this.jitter(this.baseDelayMs * 2 ** attempt);
  }

  private static async delay(ms: number): Promise<void> {
    await new Promise((resolve: (value: void) => void): unknown => setTimeout(resolve, ms));
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
    throw new HttpFetchError(200, 'Malformed JSON', `${url} returned a body that is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

type StubHttpHandler = (url: string, init?: RequestInit) => unknown;

class StubHttpClient implements IHttpClient {
  public readonly calls: Array<{ url: string; init?: RequestInit }> = [];
  private handler?: StubHttpHandler;
  private readonly queue: Array<{ kind: 'value'; value: unknown } | { kind: 'error'; error: Error }> = [];

  constructor(handler?: StubHttpHandler) {
    this.handler = handler;
  }

  public queueJson(value: unknown): this {
    this.queue.push({ kind: 'value', value });
    return this;
  }

  public queueResponse(value: Response): this {
    this.queue.push({ kind: 'value', value });
    return this;
  }

  public queueError(error: Error): this {
    this.queue.push({ kind: 'error', error });
    return this;
  }

  public setHandler(handler: StubHttpHandler): this {
    this.handler = handler;
    return this;
  }

  public fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls.push({ url, init });
    if (this.handler) {
      const result = this.handler(url, init);
      return result instanceof Response ? Promise.resolve(result) : Promise.resolve(result as Response);
    }
    const next = this.queue.shift();
    if (!next) {
      return Promise.reject(new Error(`StubHttpClient has no queued response for ${url}`));
    }
    if (next.kind === 'error') {
      return Promise.reject(next.error);
    }
    return next.value instanceof Response ? Promise.resolve(next.value) : Promise.resolve(Response.json(next.value));
  }

  public async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    this.calls.push({ url, init });
    if (this.handler) {
      const result = await this.handler(url, init);
      if (result instanceof Response) {
        const text: string = await result.text();
        if (!result.ok) {
          throw new HttpFetchError(result.status, result.statusText, text);
        }
        return parseJsonBody(text, url);
      }
      return result;
    }
    const next = this.queue.shift();
    if (!next) {
      throw new Error(`StubHttpClient has no queued response for ${url}`);
    }
    if (next.kind === 'error') {
      throw next.error;
    }
    return next.value;
  }
}

import type {   AwsSignedClient } from '@aws-access-bridge/provider-clients/aws';

export { FetchHttpClient, HttpFetchError, RetryingAwsClient, StubHttpClient, isRetryableHttpStatus };
export type { IHttpClient };


export {type AwsClientFactory, type AwsClientOptions, type AwsSignedClient} from '@aws-access-bridge/provider-clients/aws';