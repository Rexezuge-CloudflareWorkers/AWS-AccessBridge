import type { AccessKeys } from '@aws-access-bridge/shared/model';

interface ResourceDiscoveryItem {
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  region: string;
  metadata: Record<string, string>;
}

/**
 * The outcome of sweeping one collector across every configured region.
 *
 * `succeededRegions` is what makes pruning safe. The caller deletes stale rows for
 * a resource type only when *every* region it was configured to read came back, so
 * a denial or throttle in one region leaves that type's stored rows untouched
 * rather than pruning them down to whatever the surviving regions reported.
 */
interface CollectorSweepResult {
  items: ResourceDiscoveryItem[];
  /**
   * Regions whose collection returned, whether or not they held any resources. An
   * empty-but-successful region is a real answer and counts.
   */
  succeededRegions: string[];
  /**
   * Regions that failed, with the reason. Reported so the task can log *which*
   * region was unreadable instead of only that "collection failed".
   */
  failedRegions: Array<{ region: string; reason: string }>;
}

interface IAwsResourceCollector {
  readonly resourceType: string;
  /**
   * Whether this collector is region-scoped.
   *
   * `false` for a global service (S3), which is swept exactly once against its own
   * endpoint and ignores the configured region list — otherwise a 27-region list
   * would issue 27 identical requests to `s3.amazonaws.com` per account.
   */
  readonly isRegional: boolean;
  /**
   * Sweep every configured region, isolating per-region failures.
   *
   * Never throws for a regional failure: one denied region must not discard the
   * resources the other 26 returned. Callers inspect `failedRegions` to decide
   * whether pruning is safe.
   */
  collectAllRegions(accessKeys: AccessKeys, regions: readonly string[]): Promise<CollectorSweepResult>;
  /**
   * Single-region collection. Retained as the unit the sweep is built from, and
   * what a caller wanting exactly one region (a re-run, a diagnostic) uses.
   */
  collect(accessKeys: AccessKeys, region?: string): Promise<ResourceDiscoveryItem[]>;
}

export type { CollectorSweepResult, IAwsResourceCollector, ResourceDiscoveryItem };