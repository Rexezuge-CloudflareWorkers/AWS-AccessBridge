import { describe, it, expect, vi } from 'vitest';
import { CollectorRegistry, createCollectorRegistry, resolveCollector } from '@aws-access-bridge/backend-services/aws/collectors';
import { InjectableCollectorRegistry } from '@aws-access-bridge/backend-services/aws/collectors/InjectableCollectorRegistry';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import type { IAwsResourceCollector } from '@aws-access-bridge/backend-services/aws/collectors';

function stubCollector(resourceType: string): IAwsResourceCollector {
  return { resourceType, collect: vi.fn().mockResolvedValue([]) };
}

describe('CollectorRegistry', () => {
  it('resolves all five default collectors', () => {
    const all = CollectorRegistry.getAll();
    expect([...all.keys()].sort()).toEqual(['dynamodb', 'ec2', 'lambda', 'rds', 's3']);
    expect(CollectorRegistry.get('ec2').resourceType).toBe('ec2');
  });

  it('throws BadRequest for unknown types', () => {
    expect(() => CollectorRegistry.get('nope')).toThrow(BadRequestError);
    expect(() => resolveCollector(CollectorRegistry.getAll(), 'nope')).toThrow('Unsupported resource type: nope');
  });

  it('createCollectorRegistry applies overrides without mutating the default', () => {
    const stub = stubCollector('ec2');
    const custom = createCollectorRegistry({ ec2: stub });
    expect(custom.get('ec2')).toBe(stub);
    expect(CollectorRegistry.get('ec2')).not.toBe(stub);
  });
});

describe('InjectableCollectorRegistry', () => {
  it('withDefaults mirrors the static registry', () => {
    const registry = InjectableCollectorRegistry.withDefaults();
    expect([...registry.getAll().keys()].sort()).toEqual(['dynamodb', 'ec2', 'lambda', 'rds', 's3']);
    expect(registry.resolve('s3').resourceType).toBe('s3');
  });

  it('withOverrides isolates hermetic tests', () => {
    const stub = stubCollector('lambda');
    const registry = InjectableCollectorRegistry.withOverrides({ lambda: stub });
    expect(registry.get('lambda')).toBe(stub);
    expect(InjectableCollectorRegistry.withDefaults().get('lambda')).not.toBe(stub);
    expect(() => registry.resolve('nope')).toThrow(BadRequestError);
  });
});
