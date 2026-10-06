import { HttpFetchError } from './HttpFetchError';
import { parseJsonBody } from './IHttpClient';
import type { IHttpClient } from './IHttpClient';

type StubHttpHandler = (url: string, init?: RequestInit) => unknown;

type QueuedStubResponse = { kind: 'value'; value: unknown } | { kind: 'error'; error: Error };

/**
 * Scriptable `IHttpClient` double.
 *
 * Lives in `src/` rather than a test helper because it is part of this package's
 * published surface: a consumer writing a unit test against a service that takes
 * an `IHttpClient` needs one, and duplicating it per-repo is how fakes drift.
 */
class StubHttpClient implements IHttpClient {
  public readonly calls: Array<{ url: string; init?: RequestInit }> = [];
  private handler?: StubHttpHandler;
  private readonly queue: QueuedStubResponse[] = [];

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
      return StubHttpClient.toResponse(this.handler(url, init));
    }
    const next: QueuedStubResponse | undefined = this.queue.shift();
    if (!next) {
      return Promise.reject(new Error(`StubHttpClient has no queued response for ${url}`));
    }
    return next.kind === 'error' ? Promise.reject(next.error) : StubHttpClient.toResponse(next.value);
  }

  public async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    this.calls.push({ url, init });
    if (this.handler) {
      const result: unknown = await this.handler(url, init);
      return result instanceof Response ? StubHttpClient.readJson(result) : result;
    }
    const next: QueuedStubResponse | undefined = this.queue.shift();
    if (!next) {
      throw new Error(`StubHttpClient has no queued response for ${url}`);
    }
    if (next.kind === 'error') {
      throw next.error;
    }
    return next.value;
  }

  private static toResponse(value: unknown): Promise<Response> {
    return Promise.resolve(value instanceof Response ? value : Response.json(value));
  }

  private static async readJson(response: Response): Promise<unknown> {
    const text: string = await response.text();
    if (!response.ok) {
      throw new HttpFetchError(response.status, response.statusText, text);
    }
    return parseJsonBody(text, response.url || 'stub');
  }
}

export { StubHttpClient };
export type { QueuedStubResponse, StubHttpHandler };