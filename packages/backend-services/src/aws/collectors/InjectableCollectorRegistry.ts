import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { DynamoDbCollector } from './DynamoDbCollector';
import { Ec2Collector } from './Ec2Collector';

import {  createCollectorRegistry, resolveCollector } from './CollectorRegistry';
import type { IAwsResourceCollector } from './IAwsResourceCollector';
import { LambdaCollector } from './LambdaCollector';
import { RdsCollector } from './RdsCollector';
import { S3Collector } from './S3Collector';

/**
 * Injectable registry seam (Otter `InjectableEmailProviderRegistry` precedent).
 * `CollectorRegistry` static API stays for backwards compatibility;
 * new code (and hermetic tests) use `InjectableCollectorRegistry.withDefaults()`
 * / `.withOverrides(...)` without mutating the global map.
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

  public resolve(resourceType: string): IAwsResourceCollector {
    const collector = this.collectors.get(resourceType);
    if (!collector) {
      throw new BadRequestError(`Unsupported resource type: ${resourceType}`);
    }
    return collector;
  }
}

function createDefaultCollectors(): IAwsResourceCollector[] {
  return [new Ec2Collector(), new S3Collector(), new LambdaCollector(), new RdsCollector(), new DynamoDbCollector()];
}

export { InjectableCollectorRegistry, createDefaultCollectors,  };


export {type CollectorMap, CollectorRegistry} from './CollectorRegistry';