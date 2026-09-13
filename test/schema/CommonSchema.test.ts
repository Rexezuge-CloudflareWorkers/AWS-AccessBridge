import { describe, it, expect } from 'vitest';
import {
  AwsAccountIdSchema,
  AwsRegionSchema,
  AwsRoleSessionDurationSecondsSchema,
  BooleanQuerySchema,
  CollectionTypeSchema,
  isoDateQuerySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerQuerySchema,
  positiveIntegerQuerySchema,
} from '@aws-access-bridge/shared/schema';

describe('shared schema branches', () => {
  it('validates AWS account IDs', () => {
    expect(AwsAccountIdSchema.safeParse('123456789012').success).toBe(true);
    expect(AwsAccountIdSchema.safeParse('123').success).toBe(false);
  });

  it('validates calendar dates including leap days', () => {
    const schema = isoDateQuerySchema('start');
    expect(schema.safeParse('2024-02-29').success).toBe(true);
    expect(schema.safeParse('2023-02-29').success).toBe(false);
    expect(schema.safeParse('2025-13-01').success).toBe(false);
    expect(schema.safeParse('not-a-date').success).toBe(false);
  });

  it('validates integer query params with and without caps', () => {
    expect(positiveIntegerQuerySchema('limit').safeParse('10').success).toBe(true);
    expect(positiveIntegerQuerySchema('limit').safeParse('0').success).toBe(false);
    expect(positiveIntegerQuerySchema('limit', 50).safeParse('51').success).toBe(false);
    expect(positiveIntegerQuerySchema('limit', 50).safeParse('25').success).toBe(true);
    expect(nonNegativeIntegerQuerySchema('offset').safeParse('0').success).toBe(true);
    expect(nonNegativeIntegerQuerySchema('offset').safeParse('-1').success).toBe(false);
  });

  it('rejects blank strings and bad enums', () => {
    expect(nonEmptyStringSchema('name').safeParse('   ').success).toBe(false);
    expect(nonEmptyStringSchema('name').safeParse('ok').success).toBe(true);
    expect(CollectionTypeSchema.safeParse('bogus').success).toBe(false);
    expect(BooleanQuerySchema.safeParse('maybe').success).toBe(false);
    expect(AwsRegionSchema.safeParse('us-east-1').success).toBe(true);
    expect(AwsRegionSchema.safeParse(undefined).success).toBe(true);
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(60).success).toBe(false);
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(50_000).success).toBe(false);
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(3600).success).toBe(true);
  });
});
