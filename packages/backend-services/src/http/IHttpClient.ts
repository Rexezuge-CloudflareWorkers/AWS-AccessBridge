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

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
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
    return text ? (JSON.parse(text) as unknown) : {};
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
      if (result instanceof Response) {
        return Promise.resolve(result);
      }
      return Promise.resolve(result as Response);
    }
    const next = this.queue.shift();
    if (!next) {
      return Promise.reject(new Error(`StubHttpClient has no queued response for ${url}`));
    }
    if (next.kind === 'error') {
      return Promise.reject(next.error);
    }
    if (next.value instanceof Response) {
      return Promise.resolve(next.value);
    }
    return Promise.resolve(Response.json(next.value));
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
        return text ? (JSON.parse(text) as unknown) : {};
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

export { FetchHttpClient, HttpFetchError, StubHttpClient, isRetryableHttpStatus };
export type { IHttpClient, StubHttpHandler };
export type { AwsClientFactory, AwsClientOptions, AwsSignedClient } from '@aws-access-bridge/provider-clients/aws';
