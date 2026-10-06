import { AwsCollectionError } from '@aws-access-bridge/backend-errors';
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import type { AwsClientFactory, AwsSignedClient } from '../../http';
import { defaultAwsClientFactory } from '../sts';
import type { CollectorSweepResult, IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';

import { log } from '@aws-access-bridge/shared/utils';
/**
 * Region recorded for a global service's resources, so they are distinguishable
 * from a regional resource in `us-east-1`.
 */
const GLOBAL_REGION = 'global';

/**
 * Ceiling on pages walked per collector call.
 *
 * Not a correctness limit — every service here finishes in a handful of pages at
 * its own page size. It exists so a service that keeps returning a token fails
 * fast inside the request instead of running until the wall-clock limit, and the
 * truncation is logged rather than silent.
 */
const MAX_COLLECTION_PAGES = 50;

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
   * Whether this collector is region-scoped. Overridden to `false` by a global
   * service.
   */
  public abstract readonly isRegional: boolean;

  /**
   * Sweep every configured region, isolating per-region failures.
   *
   * **This is what makes the inventory multi-region.** `BaseAwsCollector.collect`
   * took an optional region that defaulted to `us-east-1` and had exactly one
   * caller which passed none — so EC2, Lambda, RDS and DynamoDB inventory covered
   * `us-east-1` and nothing else, while the API and UI both filter by region and
   * presented the result as a complete inventory.
   *
   * Failures are collected rather than thrown: a role denied in one region still
   * has the other 26, and discarding those would make a single `AccessDenied`
   * erase a real inventory. `succeededRegions` is what a caller prunes on, and it
   * is only complete when nothing failed.
   *
   * Regions are swept concurrently rather than in sequence. A sequential sweep
   * would multiply collection wall-clock time by the region count — 27 signed
   * round trips per resource type, serially, inside a cron-driven Durable Object
   * request that is also walking a credential chain and hitting a 10-minute tick.
   */
  public async collectAllRegions(accessKeys: AccessKeys, regions: readonly string[]): Promise<CollectorSweepResult> {
    if (!this.isRegional) {
      // A global service answers the same wherever it is asked. Swept once, and
      // recorded against a single region so the caller's "all configured regions
      // succeeded" test still holds.
      const region: string = this.globalRegion;
      const items: ResourceDiscoveryItem[] = await this.collect(accessKeys, region);
      return { failedRegions: [], items, succeededRegions: [region] };
    }

    const settled: Array<{ items: ResourceDiscoveryItem[]; region: string; reason?: string }> = await Promise.all(
      regions.map(
        async (region: string): Promise<{ items: ResourceDiscoveryItem[]; region: string; reason?: string }> => {
          try {
            return { items: await this.collect(accessKeys, region), region };
          } catch (error: unknown) {
            return { items: [], reason: error instanceof Error ? error.message : String(error), region };
          }
        },
      ),
    );

    const result: CollectorSweepResult = { failedRegions: [], items: [], succeededRegions: [] };
    for (const entry of settled) {
      if (entry.reason === undefined) {
        result.succeededRegions.push(entry.region);
        result.items.push(...entry.items);
      } else {
        result.failedRegions.push({ reason: entry.reason, region: entry.region });
      }
    }
    return result;
  }

  /**
   * The region a global service is recorded under.
   *
   * `global` rather than a real region, so a global resource cannot be confused
   * with a regional one that happens to sit in `us-east-1`.
   */
  protected readonly globalRegion: string = GLOBAL_REGION;

  /**
  Signed request, returning the response body as text. Throws on non-OK.

  * `init` carries the method, headers and body. It is a parameter rather than
  * baked in because the Query-protocol collectors need a form-encoded POST while
  * the S3 collector needs a bare GET, and the base must not choose between them.
  */
  protected async fetchText(url: string, service: string, region: string, accessKeys: AccessKeys, init?: RequestInit): Promise<string> {
    const response: Response = await this.send(url, service, region, accessKeys, init);
    return response.text();
  }

  /**
  Signed request, returning the response body as JSON. Throws on non-OK or a malformed body.
  */
  protected fetchJson<T>(url: string, service: string, region: string, accessKeys: AccessKeys, init?: RequestInit): Promise<T> {
    return this.parseJson<T>(() => this.send(url, service, region, accessKeys, init), service, region);
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

  /**
   * Walk every page of a paginated AWS list call and return the pages in order.
   *
   * **Why this cannot be skipped.** Every collector here read one page and called
   * it a complete answer: EC2 caps `DescribeInstances` at 1000 instances, Lambda
   * and DynamoDB at 100 items, RDS at 100. `ResourceInventoryCollectionTask`
   * *prunes* previously collected rows for any type whose collector returned, so an
   * account with more resources than fit on one page had its unreturned remainder
   * deleted on every run — a first collection stored 1000 instances and each later
   * run deleted the other 4000 before re-adding 1000. Reading a page is not the
   * same as having read the list.
   *
   * `fetchPage` receives the token for the page it should fetch (`undefined` for
   * the first) and returns that page plus the token AWS supplied for the next, if
   * any. Each service spells this differently — EC2 and RDS use a Query parameter,
   * Lambda a `Marker` query parameter, DynamoDB an `ExclusiveStartTableName` body
   * field — so both halves are supplied by the caller rather than inferred here.
   *
   * A non-OK response still throws, so a denied region or a throttled page is a
   * failure rather than a short list, and the caller's existing "denied is not
   * empty" rule still holds.
   */
  protected async paginate<TPage>(
    fetchPage: (token: string | undefined) => Promise<{ page: TPage; nextToken: string | undefined }>,
    readNextToken: (page: TPage) => string | undefined,
    service: string,
    region: string,
  ): Promise<TPage[]> {
    const pages: TPage[] = [];
    const seenTokens = new Set<string>();
    let token: string | undefined;
    let pageCount = 0;

    for (;;) {
      const { page, nextToken }: { page: TPage; nextToken: string | undefined } = await fetchPage(token);
      pages.push(page);
      pageCount += 1;

      if (!nextToken) {
        break;
      }
      // A service that keeps handing back tokens would otherwise loop until the
      // request's own wall-clock limit. Stop with what was read and say so —
      // truncating loudly beats hanging, and beats silently treating a partial
      // read as the whole list.
      if (pageCount >= MAX_COLLECTION_PAGES || seenTokens.has(nextToken)) {
        log.error(`${this.resourceType} collection from ${service}.${region} stopped after ${pageCount} page(s) without exhausting its pagination; returning a partial list.`);
        break;
      }
      seenTokens.add(nextToken);
      token = nextToken;
    }

    return pages;
  }

  private async send(url: string, service: string, region: string, accessKeys: AccessKeys, init?: RequestInit): Promise<Response> {
    const client: AwsSignedClient = this.clientFactory({ service, region, keys: accessKeys });
    // Only pass `init` when a collector supplied one, so the collectors needing no
    // method, headers or body keep issuing the plain single-argument call.
    const response: Response = init ? await client.fetch(url, init) : await client.fetch(url);
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
    log.error(message);
    throw new AwsCollectionError(message, response.status, this.resourceType);
  }

  protected abstract collectWithRegion(accessKeys: AccessKeys, region: string): Promise<ResourceDiscoveryItem[]>;
}

export { BaseAwsCollector };