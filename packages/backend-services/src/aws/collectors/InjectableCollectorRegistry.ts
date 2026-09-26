import { createCollectorRegistry, resolveCollector } from './CollectorRegistry';
import type { IAwsResourceCollector } from './IAwsResourceCollector';

/**
 * Injectable registry seam (Otter `InjectableEmailProviderRegistry` precedent).
 *
 * `ResourceInventoryCollectionTask` uses the static `CollectorRegistry`; the
 * composition root binds an instance of this class under
 * `Tokens.CollectorRegistry` so tests can substitute collectors without
 * mutating the global map.
 */
class InjectableCollectorRegistry {
  private readonly collectors: Map<string, IAwsResourceCollector>;

  constructor(collectors?: Map<string, IAwsResourceCollector>) {
    this.collectors = collectors ?? createCollectorRegistry();
  }

  public static withDefaults(): InjectableCollectorRegistry {
    return new InjectableCollectorRegistry(createCollectorRegistry());
  }

  public static withOverrides(
    overrides?: ReadonlyMap<string, IAwsResourceCollector> | Readonly<Record<string, IAwsResourceCollector>>,
  ): InjectableCollectorRegistry {
    return new InjectableCollectorRegistry(createCollectorRegistry(overrides));
  }

  public get(resourceType: string): IAwsResourceCollector {
    return resolveCollector(this.collectors, resourceType);
  }

  public getAll(): ReadonlyMap<string, IAwsResourceCollector> {
    return this.collectors;
  }
}

export { InjectableCollectorRegistry };
export type { CollectorMap, CollectorRegistry } from './CollectorRegistry';
