import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

/**
 * Abstract Template base for AWS resource collectors (Strategy pattern).
 * Previously each of the 5 collectors repeated the
 * `clientFactory` ctor + `fetch → !ok → [] → parse` shape.
 * Subclasses implement `buildRequest` + `parseResponse`; the base owns
 * fetch, error isolation (`[]` on non-OK), and region plumbing.
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

  protected async fetchText(url: string, service: string, region: string, accessKeys: AccessKeys): Promise<string | undefined> {
    const client = this.clientFactory({ service, region, keys: accessKeys });
    const response: Response = await client.fetch(url);
    const text: string = await response.text();
    if (!response.ok) {
      console.error(`${this.resourceType} collection failed: ${response.status}`);
      return undefined;
    }
    return text;
  }

  protected async fetchJson<T>(url: string, service: string, region: string, accessKeys: AccessKeys): Promise<T | undefined> {
    const client = this.clientFactory({ service, region, keys: accessKeys });
    const response: Response = await client.fetch(url);
    if (!response.ok) {
      console.error(`${this.resourceType} collection failed: ${response.status}`);
      return undefined;
    }
    return (await response.json());
  }

  protected abstract collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]>;
}

export { BaseAwsCollector };
