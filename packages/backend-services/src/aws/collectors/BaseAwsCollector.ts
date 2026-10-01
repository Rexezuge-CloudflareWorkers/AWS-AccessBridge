import { AwsCollectionError } from '@aws-access-bridge/backend-errors';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

/**
 * Abstract Template base for AWS resource collectors (Strategy pattern).
 * Previously each of the 5 collectors repeated the
 * `clientFactory` ctor + `fetch → check → parse` shape.
 * Subclasses implement `collectWithRegion`; the base owns the signed request,
 * the non-OK decision, body parsing, and region plumbing.
 *
 * A non-OK response **throws** `AwsCollectionError` rather than resolving to an
 * empty list. "Denied" and "this account has none" are different answers, and a
 * caller that prunes on an empty result would otherwise delete a real inventory
 * because of one throttled `DescribeInstances`. Isolating the failure is the
 * caller's job — `ResourceInventoryCollectionTask` catches per collector and
 * skips pruning for every type that failed.
 */
abstract class BaseAwsCollector implements IAwsResourceCollector {
  public abstract readonly resourceType: string;
  protected readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public collect(accessKeys: AccessKeys, region = 'us-east-1'): Promise<ResourceDiscoveryItem[]> {
    return this.collectWithRegion(accessKeys, region);
  }

  /**
  Signed GET, returning the response body as text. Throws on non-OK.
  */
  protected async fetchText(url: string, service: string, region: string, accessKeys: AccessKeys): Promise<string> {
    const response: Response = await this.send(url, service, region, accessKeys);
    return response.text();
  }

  /**
  Signed GET, returning the response body as JSON. Throws on non-OK or a malformed body.
  */
  protected fetchJson<T>(url: string, service: string, region: string, accessKeys: AccessKeys): Promise<T> {
    return this.parseJson<T>(() => this.send(url, service, region, accessKeys), service, region);
  }

  /**
  As `fetchJson`, but for a service that needs POST plus its own headers (DynamoDB's JSON protocol).
  */
  protected fetchJsonWithInit<T>(url: string, init: RequestInit, service: string, region: string, accessKeys: AccessKeys): Promise<T> {
    return this.parseJson<T>(async () => {
      const client = this.clientFactory({ service, region, keys: accessKeys });
      const response: Response = await client.fetch(url, init);
      this.assertOk(response, service, region);
      return response;
    }, service, region);
  }

  private async send(url: string, service: string, region: string, accessKeys: AccessKeys): Promise<Response> {
    const client = this.clientFactory({ service, region, keys: accessKeys });
    const response: Response = await client.fetch(url);
    this.assertOk(response, service, region);
    return response;
  }

  private async parseJson<T>(send: () => Promise<Response>, service: string, region: string): Promise<T> {
    const response: Response = await send();
    try {
      return (await response.json());
    } catch (error: unknown) {
      // A malformed body is a failure, not an empty result: letting the
      // `SyntaxError` escape would bypass the `IServiceError` taxonomy and the
      // caller would prune the type it just failed to read.
      throw new AwsCollectionError(
        `${this.resourceType} collection returned a malformed JSON body from ${service}.${region}: ${error instanceof Error ? error.message : 'unknown error'}`,
        response.status,
        this.resourceType,
      );
    }
  }

  private assertOk(response: Response, service: string, region: string): void {
    if (response.ok) {
      return;
    }

    const message: string = `${this.resourceType} collection failed: ${service}.${region} returned HTTP ${response.status}`;
    console.error(message);
    throw new AwsCollectionError(message, response.status, this.resourceType);
  }

  protected abstract collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]>;
}

export { BaseAwsCollector };