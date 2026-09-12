import type { AccessKeys } from '@aws-access-bridge/shared/model';

interface IHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

class FetchHttpClient implements IHttpClient {
  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

class StubHttpClient implements IHttpClient {
  private readonly handler: (url: string, init?: RequestInit) => Promise<Response> | Response;

  constructor(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    this.handler = handler;
  }

  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return Promise.resolve(this.handler(url, init));
  }
}

interface AwsClientOptions {
  service: string;
  region: string;
  keys: AccessKeys;
}

interface AwsSignedClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

type AwsClientFactory = (options: AwsClientOptions) => AwsSignedClient;

export { FetchHttpClient, StubHttpClient };
export type { AwsClientFactory, AwsClientOptions, AwsSignedClient, IHttpClient };
