/**
 * Seeds emulator state that the production code paths then read back.
 *
 * Every seed goes through the real signing stack (`flociFetch`), so the suite
 * exercises the same SigV4 path the app uses and Floci routes each call the same
 * way it would in production. Query-protocol seeds reuse the production
 * `awsQueryRequest`, so a seed cannot drift from the request shape the code under
 * test now sends.
 *
 * Seed failures are fatal and name the response body: a seed that silently
 * no-ops would turn the matching assertion into a test that passes for the wrong
 * reason.
 */
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { awsQueryRequest } from '@aws-access-bridge/provider-clients/aws';
import { ACCOUNT_A, accountKeys, flociFetch } from './floci';

/**
 * Anything Floci has not heard of may be assumed, which keeps the cross-account
 * hop in the STS suite from depending on trust-policy evaluation. Written
 * explicitly rather than omitted so a future `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED`
 * does not turn this suite red for an unrelated reason.
 */
const ASSUME_ANY: string = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { AWS: '*' }, Action: 'sts:AssumeRole' }],
});

/**
 * AWS error codes meaning "the resource is already in the state this seed
 * wanted". Tolerated so the suite is re-runnable against a long-lived emulator —
 * a developer's local Floci keeps its state between runs, and without this the
 * second run fails on `EntityAlreadyExists` for every seed.
 */
const ALREADY_EXISTS = ['EntityAlreadyExists', 'BucketAlreadyExists', 'BucketAlreadyOwnedByYou', 'DBInstanceAlreadyExists'];

/**
 * Fail a seed loudly. A no-op seed turns its assertion into a false pass, so the
 * only tolerated failure is one that means the resource is *already* correct.
 */
async function expectSeeded(response: Response, action: string): Promise<void> {
  const body: string = await response.text();
  if (response.ok || ALREADY_EXISTS.some((code) => body.includes(code))) {
    return;
  }
  throw new Error(`Seeding ${action} failed: HTTP ${response.status} ${response.statusText}\n${body}`);
}

/**
 * A single S3 object, sized so Cost Explorer reports a non-zero amount.
 *
 * Not incidental. Floci prices S3 as `TimedStorage-Standard` x GB-month over
 * `listBuckets` + `listObjects`, and the production parser *drops any group
 * whose amount is not positive* — so a cost assertion needs real bytes behind
 * it, in a bucket, or it silently becomes a pass-by-absence. Two traps here, both
 * measured against Floci 2.1.0:
 *
 * - The bucket must actually hold an object. `PUT /name` creates a *bucket*;
 *   an empty bucket prices at exactly `0.0000000000`.
 * - 16 MiB reports `0.00037`. A 1 MiB object reports `0.000023`, which is
 *   positive today but close enough to the formatting floor that a change to
 *   Floci's decimal precision would round it away. 16 MiB costs ~450ms.
 */
const S3_OBJECT_BYTES = 16 * 1024 * 1024;

/** `iam:CreateRole` — the target `sts:AssumeRole` will not invent for itself. */
async function createRole(roleName: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<string> {
  const params: URLSearchParams = new URLSearchParams({
    Action: 'CreateRole',
    Version: '2010-05-08',
    RoleName: roleName,
    AssumeRolePolicyDocument: ASSUME_ANY,
  });
  const request = awsQueryRequest('https://iam.amazonaws.com/', params);
  await expectSeeded(await flociFetch('iam', request.url, request.init, keys), `iam:CreateRole ${roleName}`);
  return `arn:aws:iam::${keys.accessKeyId}:role/${roleName}`;
}

/** `s3:CreateBucket` plus one priced object (see `S3_OBJECT_BYTES`). */
async function createBucketWithObject(bucket: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<void> {
  await expectSeeded(await flociFetch('s3', `https://s3.amazonaws.com/${bucket}`, { method: 'PUT' }, keys), `s3:CreateBucket ${bucket}`);
  await expectSeeded(
    await flociFetch('s3', `https://s3.amazonaws.com/${bucket}/smoke.bin`, { method: 'PUT', body: 'f'.repeat(S3_OBJECT_BYTES) }, keys),
    `s3:PutObject ${bucket}/smoke.bin`,
  );
}

/**
 * `rds:CreateDBInstance`.
 *
 * Floci keeps the instance as metadata and reaches `available` even with no
 * reachable Docker daemon, which is why this suite needs no socket mount: the
 * collector under test only ever reads `DescribeDBInstances`. Reaching a real
 * engine would need `-v /var/run/docker.sock` and would add a container start to
 * every CI run to learn nothing this parser does not already learn here.
 */
async function createDbInstance(identifier: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<void> {
  const params: URLSearchParams = new URLSearchParams({
    Action: 'CreateDBInstance',
    Version: '2014-10-31',
    DBInstanceIdentifier: identifier,
    DBInstanceClass: 'db.t3.micro',
    Engine: 'postgres',
    MasterUsername: 'smoke',
    MasterUserPassword: 'smoke-secret',
    AllocatedStorage: '20',
  });
  const request = awsQueryRequest('https://rds.us-east-1.amazonaws.com/', params);
  await expectSeeded(await flociFetch('rds', request.url, request.init, keys), `rds:CreateDBInstance ${identifier}`);
}

export { createBucketWithObject, createDbInstance, createRole };
