import { z } from 'zod';

const AWS_ACCOUNT_ID_PATTERN: RegExp = /^\d{12}$/;
const AWS_IAM_PRINCIPAL_ARN_PATTERN: RegExp = /^arn:aws:iam::\d{12}:(role|user)\/.+$/;
const AWS_REGION_PATTERN: RegExp = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const UUID_PATTERN: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN: RegExp = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER_PATTERN: RegExp = /^(0|[1-9]\d*)$/;

const hasRealDateParts = (date: string): boolean => {
  const match: RegExpMatchArray | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;

  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const parsed: Date = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const nonEmptyStringSchema = (fieldName: string, maxLength: number = 2048) =>
  z
    .string()
    .min(1, `${fieldName} is required.`)
    .max(maxLength, `${fieldName} must be ${maxLength} characters or less.`)
    .refine((value: string): boolean => value.trim().length > 0, `${fieldName} is required.`);

const positiveIntegerQuerySchema = (fieldName: string, maxValue?: number) => {
  const schema = z
    .string()
    .regex(POSITIVE_INTEGER_PATTERN, `${fieldName} must be a positive integer.`)
    .transform(Number)
    .pipe(z.number().int().min(1, `${fieldName} must be a positive integer.`));

  return maxValue === undefined ? schema : schema.pipe(z.number().int().min(1).max(maxValue, `${fieldName} must be ${maxValue} or less.`));
};

const nonNegativeIntegerQuerySchema = (fieldName: string) =>
  z
    .string()
    .regex(NON_NEGATIVE_INTEGER_PATTERN, `${fieldName} must be a non-negative integer.`)
    .transform(Number)
    .pipe(z.number().int().min(0, `${fieldName} must be a non-negative integer.`));

const isoDateQuerySchema = (fieldName: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${fieldName} must use YYYY-MM-DD format.`)
    .refine(hasRealDateParts, `${fieldName} must be a valid calendar date.`);

const AwsAccountIdSchema = z.string().regex(AWS_ACCOUNT_ID_PATTERN, 'AWS Account ID must be exactly 12 digits.');
const AwsIamPrincipalArnSchema = z.string().regex(AWS_IAM_PRINCIPAL_ARN_PATTERN, 'Principal ARN must be an AWS IAM role or user ARN.');
const AwsRoleNameSchema = nonEmptyStringSchema('roleName', 128);
const AwsAccessKeyIdSchema = nonEmptyStringSchema('accessKeyId', 128);
const AwsSecretAccessKeySchema = nonEmptyStringSchema('secretAccessKey', 512);
const AwsSessionTokenSchema = nonEmptyStringSchema('sessionToken', 8192).optional();
const AwsDestinationPathSchema = nonEmptyStringSchema('destinationPath', 2048)
  .refine((value: string): boolean => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value), 'destinationPath must be a console path, not a URL.')
  .optional();
const AwsRegionSchema = z.string().regex(AWS_REGION_PATTERN, 'destinationRegion must be a valid AWS region.').optional();
const AwsRoleSessionDurationSecondsSchema = z
  .number()
  .int('roleSessionDurationSeconds must be an integer.')
  .min(900, 'roleSessionDurationSeconds must be at least 900 seconds.')
  .max(43_200, 'roleSessionDurationSeconds must be 43200 seconds or less.')
  .optional();
const EmailSchema = z.string().email('userEmail must be a valid email address.').max(320, 'userEmail must be 320 characters or less.');
const TeamRoleSchema = z.enum(['admin', 'member']);
const CollectionTypeSchema = z.enum(['cost', 'resource']);
const PeriodTypeSchema = z.enum(['daily', 'monthly']);
const UuidSchema = z.string().regex(UUID_PATTERN, 'Value must be a valid UUID.');
const BooleanQuerySchema = z.enum(['true', 'false']);

export {
  AwsAccessKeyIdSchema,
  AwsAccountIdSchema,
  AwsDestinationPathSchema,
  AwsIamPrincipalArnSchema,
  AwsRegionSchema,
  AwsRoleSessionDurationSecondsSchema,
  AwsRoleNameSchema,
  AwsSecretAccessKeySchema,
  AwsSessionTokenSchema,
  BooleanQuerySchema,
  CollectionTypeSchema,
  EmailSchema,
  PeriodTypeSchema,
  TeamRoleSchema,
  UuidSchema,
  isoDateQuerySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerQuerySchema,
  positiveIntegerQuerySchema,
};
