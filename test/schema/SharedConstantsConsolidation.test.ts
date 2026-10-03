import { describe, it, expect } from 'vitest';
import { isAwsAccountId, AWS_ACCOUNT_ID_ERROR_MESSAGE, buildPrincipalArn } from '@aws-access-bridge/shared/utils/aws';
import { DEFAULT_TEAM_ID } from '@aws-access-bridge/shared/constants';
import { AwsAccountIdSchema } from '@aws-access-bridge/shared/schema/common';
import { buildFederateUrl } from '@aws-access-bridge/web/services/accountService';

/**
 * The constants that had drifted into several definitions.
 *
 * Each case below pins a value against its *canonical* home, so a future edit
 * that changes one copy and not the others fails here rather than in production.
 */

/**
 * `AWS_ACCOUNT_ID_PATTERN` and its message were previously four spellings: a
 * regex in `schema/common`, a second regex in `AccessService` consumed by
 * `AccountService`, and inline literals in the onboarding hook and `AccountStep`
 * — with two different wordings of the error. The UI therefore accepted input the
 * API rejected, and a user only learned about it from a 400.
 */
describe('isAwsAccountId', () => {
  it.each(['123456789012', '000000000000', '999999999999'])('accepts %s', (value) => {
    expect(isAwsAccountId(value)).toBe(true);
  });

  it.each([
    ['too short', '12345678901'],
    ['too long', '1234567890123'],
    ['empty', ''],
    ['letters', '12345678901a'],
    ['leading space', ' 123456789012'],
    ['trailing space', '123456789012 '],
    ['punctuation', '123-456-7890'],
    ['aws spelled out', 'aws-account'],
  ])('rejects %s (%j)', (_label, value) => {
    expect(isAwsAccountId(value)).toBe(false);
  });

  it('agrees with the zod schema the API validates with', () => {
    // The point of the consolidation: the predicate the UI gates its button on
    // and the schema the API enforces must never disagree.
    for (const candidate of ['123456789012', '12345', '', 'abcdefghijkl', '000000000000', '12345678901a']) {
      expect(isAwsAccountId(candidate)).toBe(AwsAccountIdSchema.safeParse(candidate).success);
    }
  });

  it('uses the schema’s message, so the user sees one wording', () => {
    const parsed = AwsAccountIdSchema.safeParse('nope');
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe(AWS_ACCOUNT_ID_ERROR_MESSAGE);
  });

  it('is not fooled by a regex carrying global state', () => {
    // A `/g` regex keeps `lastIndex` between `.test()` calls, so two consecutive
    // valid inputs would fail alternately. The shared pattern is not global, and
    // this pins that — a `g` flag added later would break the button, not throw.
    expect(isAwsAccountId('123456789012')).toBe(true);
    expect(isAwsAccountId('123456789012')).toBe(true);
    expect(isAwsAccountId('123456789012')).toBe(true);
  });
});

describe('buildPrincipalArn', () => {
  it('builds an IAM role ARN', () => {
    expect(buildPrincipalArn('123456789012', 'Dev')).toBe('arn:aws:iam::123456789012:role/Dev');
  });
});

/**
 * `DEFAULT_TEAM_ID` was defined in `TeamService`, in the web app's
 * `lib/constants`, and inline in an OpenAPI example. The two real definitions
 * could disagree about which team id deletion is refused for — a failure that
 * would present as "the default team deleted anyway" rather than an error.
 */
describe('DEFAULT_TEAM_ID', () => {
  it('is the all-zero UUID the sentinel has always been', () => {
    expect(DEFAULT_TEAM_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('matches the UUID shape the API validates against', () => {
    // If the sentinel ever stopped being a UUID-shaped string, the admin route
    // that lists it would return an id its own schemas reject.
    expect(AwsAccountIdSchema.safeParse(DEFAULT_TEAM_ID.replaceAll('-', '')).success).toBe(false);
    expect(DEFAULT_TEAM_ID).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  });
});

/**
 * `buildFederateUrl` previously handled only the required pair while
 * `ResourceInventory` hand-built the same endpoint to add the destination
 * parameters — two builders against one server-side `FederateQuerySchema`.
 */
describe('buildFederateUrl', () => {
  it('builds the required pair', () => {
    expect(buildFederateUrl('123456789012', 'Dev')).toBe('/user/aws/federate?awsAccountId=123456789012&role=Dev');
  });

  it('adds a destination path', () => {
    const url = new URL(buildFederateUrl('123456789012', 'Dev', { destinationPath: '/s3/bucket' }), 'https://app.invalid');
    expect(url.pathname).toBe('/user/aws/federate');
    expect(url.searchParams.get('awsAccountId')).toBe('123456789012');
    expect(url.searchParams.get('role')).toBe('Dev');
    expect(url.searchParams.get('destinationPath')).toBe('/s3/bucket');
  });

  it('adds a destination region', () => {
    const url = new URL(buildFederateUrl('123456789012', 'Dev', { destinationPath: '/ec2/instances', destinationRegion: 'eu-west-1' }), 'https://app.invalid');
    expect(url.searchParams.get('destinationRegion')).toBe('eu-west-1');
  });

  it('omits absent destination parameters entirely', () => {
    // The old hand-rolled builder always set `destinationPath` and only
    // conditionally set the region; an empty value must not appear as `""`.
    const url = new URL(buildFederateUrl('123456789012', 'Dev', { destinationPath: undefined, destinationRegion: undefined }), 'https://app.invalid');
    expect(url.searchParams.has('destinationPath')).toBe(false);
    expect(url.searchParams.has('destinationRegion')).toBe(false);
  });

  it('escapes values that would otherwise truncate the query', () => {
    // A role name containing a separator must not invent a new parameter — the
    // old template-literal form only encoded `role`, not `awsAccountId`.
    const url = new URL(buildFederateUrl('123456789012', 'Dev&role=admin'), 'https://app.invalid');
    expect(url.searchParams.get('role')).toBe('Dev&role=admin');
    expect([...url.searchParams.keys()].sort()).toEqual(['awsAccountId', 'role']);
  });

  it('escapes a hash in a destination path', () => {
    const url = new URL(buildFederateUrl('123456789012', 'Dev', { destinationPath: '/s3/b#1' }), 'https://app.invalid');
    expect(url.searchParams.get('destinationPath')).toBe('/s3/b#1');
    expect(url.hash).toBe('');
  });
});