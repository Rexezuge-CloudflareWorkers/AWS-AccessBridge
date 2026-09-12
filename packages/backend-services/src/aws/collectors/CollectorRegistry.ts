import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { DynamoDbCollector } from './DynamoDbCollector';
import { Ec2Collector } from './Ec2Collector';
import type { IAwsResourceCollector } from './IAwsResourceCollector';
import { LambdaCollector } from './LambdaCollector';
import { RdsCollector } from './RdsCollector';
import { S3Collector } from './S3Collector';

const ec2Collector = new Ec2Collector();
const s3Collector = new S3Collector();
const lambdaCollector = new LambdaCollector();
const rdsCollector = new RdsCollector();
const dynamoDbCollector = new DynamoDbCollector();

const COLLECTORS: ReadonlyMap<string, IAwsResourceCollector> = new Map<string, IAwsResourceCollector>([
  [ec2Collector.resourceType, ec2Collector],
  [s3Collector.resourceType, s3Collector],
  [lambdaCollector.resourceType, lambdaCollector],
  [rdsCollector.resourceType, rdsCollector],
  [dynamoDbCollector.resourceType, dynamoDbCollector],
]);

class CollectorRegistry {
  public static get(resourceType: string): IAwsResourceCollector {
    return resolveCollector(COLLECTORS, resourceType);
  }

  public static getAll(): ReadonlyMap<string, IAwsResourceCollector> {
    return COLLECTORS;
  }
}

type CollectorMap = ReadonlyMap<string, IAwsResourceCollector>;

function resolveCollector(registry: CollectorMap, resourceType: string): IAwsResourceCollector {
  const collector = registry.get(resourceType);
  if (!collector) throw new BadRequestError(`Unsupported resource type: ${resourceType}`);
  return collector;
}

function createCollectorRegistry(
  overrides?: ReadonlyMap<string, IAwsResourceCollector> | Readonly<Record<string, IAwsResourceCollector>>,
): Map<string, IAwsResourceCollector> {
  const registry = new Map<string, IAwsResourceCollector>(COLLECTORS);
  if (overrides) {
    const entries: Iterable<readonly [string, IAwsResourceCollector]> =
      overrides instanceof Map ? overrides.entries() : Object.entries(overrides);
    for (const [key, collector] of entries) {
      registry.set(key, collector);
    }
  }
  return registry;
}

export { CollectorRegistry, createCollectorRegistry, resolveCollector };
export type { CollectorMap };

export type { IAwsResourceCollector, ResourceDiscoveryItem } from './IAwsResourceCollector';
