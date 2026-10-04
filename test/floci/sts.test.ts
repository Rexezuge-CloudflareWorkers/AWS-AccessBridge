import { describe, expect, it } from 'vitest';
import { StsService } from '@aws-access-bridge/backend-services/aws';
import type { AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { ACCOUNT_A, ACCOUNT_B, SECRET, accountKeys, flociClientFactory } from './helpers/floci';
import { createRole } from './helpers/seed';

/**
 * STS over a real signed round trip.
 *
 * `StsService` is the object the composition root builds, so this covers the
 * `RetryingAwsClient` wrapper too, not just the raw XML parser. Emulator
 * readiness is proven once for the run by `global-setup.ts`.
 */
describe('STS against Floci', () => {
  it('parses GetCallerIdentity from a real response', async () => {
    const service = new StsService(flociClientFactory());
    const identity = await service.validateCredentials(ACCOUNT_A, SECRET);

    // Floci derives the account from a 12-digit key id, so this asserts the
    // `<Account>` tag was read rather than merely present.
    expect(identity.accountId).toBe(ACCOUNT_A);
    expect(identity.arn).toContain(`:${ACCOUNT_A}:`);
    expect(identity.userId).toBeTruthy();
  });

  it('parses AssumeRole credentials from a real response', async () => {
    const roleArn = await createRole('floci-sts-single-hop');
    const service = new StsService(flociClientFactory());

    const assumed: AccessKeysWithExpiration = await service.assumeRole(roleArn, accountKeys(ACCOUNT_A), 'floci-smoke-session');

    expect(assumed.accessKeyId).toBeTruthy();
    expect(assumed.secretAccessKey).toBeTruthy();
    // The parser requires all four; a missing one throws rather than returning
    // a partial, so reaching this line already proves they were all found.
    expect(assumed.sessionToken).toBeTruthy();
    expect(assumed.expiration).toBeTruthy();
    expect(Number.isNaN(Date.parse(assumed.expiration ?? ''))).toBe(false);
  });

  it('walks a two-hop cross-account chain with the intermediate credentials', async () => {
    // The feature this repo exists for: a chain of principals, each hop assumed
    // with the previous hop's *session* credentials. The roles live in
    // different accounts and Floci scopes IAM per account, so hop two only
    // resolves if the session token from hop one was parsed and forwarded
    // rather than dropped.
    const hopOneArn = await createRole('floci-chain-hop-one', accountKeys(ACCOUNT_A));
    const hopTwoArn = await createRole('floci-chain-hop-two', accountKeys(ACCOUNT_B));

    const service = new StsService(flociClientFactory());
    const leaf = accountKeys(ACCOUNT_A);
    const leafIdentity = await service.validateCredentials(leaf.accessKeyId, leaf.secretAccessKey);

    const hopOne = await service.assumeRole(hopOneArn, leaf, 'chain-hop-one');
    const hopTwo = await service.assumeRole(hopTwoArn, hopOne, 'chain-hop-two');

    expect(hopTwo.accessKeyId).toBeTruthy();
    expect(hopTwo.sessionToken).toBeTruthy();
    expect(hopTwo.accessKeyId).not.toBe(leaf.accessKeyId);

    // The chain's output has to work as credentials in its own right — that is
    // the whole contract of `AssumeRoleService`. Asserted as a *different*
    // caller identity rather than a specific account: Floci documents that
    // temporary credentials resolve to the assumed role's account for routing,
    // and that `Arn`/`UserId` match the `AssumedRoleUser`, but it does not
    // promise `<Account>` reports the role's account. Pinning that here would
    // test the emulator's account model, not our parser.
    const asHopTwo = await service.validateCredentials(hopTwo.accessKeyId, hopTwo.secretAccessKey, hopTwo.sessionToken);
    expect(asHopTwo.arn).not.toBe(leafIdentity.arn);
    expect(asHopTwo.userId).not.toBe(leafIdentity.userId);
  });

  it('reports an unusable role rather than inventing credentials', async () => {
    // Floci answers AccessDenied for a role that does not exist, which is what
    // the production `UnauthorizedError` path is built on. Asserting the throw
    // keeps the emulator honest: if it started minting credentials for unknown
    // ARNs, the two-hop test above would stop proving anything.
    const service = new StsService(flociClientFactory());
    await expect(service.assumeRole(`arn:aws:iam::${ACCOUNT_A}:role/does-not-exist`, accountKeys(ACCOUNT_A), 'missing')).rejects.toThrow();
  });
});
