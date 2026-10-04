/**
 * Seeds emulator state that the production code paths then read back.
 *
 * Every seed goes through the real signing stack (`flociFetch`), so the suite
 * exercises the same SigV4 path the app uses and Floci routes each call the same
 * way it would in production. Seed failures are fatal and name the response body:
 * a seed that silently no-ops would turn the matching assertion into a test that
 * passes for the wrong reason.
 */
import type { AccessKeys } from '@aws-access-bridge/shared/model';
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

/** Fail a seed loudly. A no-op seed turns its assertion into a false pass. */
async function expectSeeded(response: Response, action: string): Promise<void> {
  if (response.ok) {
    return;
  }
  const body: string = await response.text();
  throw new Error(`Seeding ${action} failed: HTTP ${response.status} ${response.statusText}\n${body}`);
}

/** `iam:CreateRole` — the target `sts:AssumeRole` refuses to invent for itself. */
async function createRole(roleName: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<string> {
  const params: URLSearchParams = new URLSearchParams({
    Action: 'CreateRole',
    Version: '2010-05-08',
    RoleName: roleName,
    AssumeRolePolicyDocument: ASSUME_ANY,
  });
  await expectSeeded(
    await flociFetch('iam', `https://iam.amazonaws.com/?${params.toString()}`, { method: 'POST' }, keys),
    `iam:CreateRole ${roleName}`,
  );
  return `arn:aws:iam::${keys.accessKeyId}:role/${roleName}`;
}

/**
 * `s3:CreateBucket`, plus one object.
 *
 * The object is not incidental. Cost Explorer synthesizes S3 cost as
 * `TimedStorage-Standard` x GB-month over `listBuckets` + `listObjects`, and the
 * production parser *drops any group whose amount is not positive*. A few bytes
 * of payload would price out around 1e-7 of a cent — small enough that an
 * emulator change to amount formatting could silently zero the group and turn
 * the Cost Explorer assertion into a pass-by-absence. A megabyte keeps the
 * figure comfortably above that floor for a few cents per GB-month.
 */
const S3_OBJECT_BYTES = 1024 * 1024;

async function createBucketWithObject(bucket: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<void> {
  await expectSeeded(await flociFetch('s3', `https://s3.amazonaws.com/${bucket}`, { method: 'PUT' }, keys), `s3:CreateBucket ${bucket}`);
  await expectSeeded(
    await flociFetch('s3', `https://s3.amazonaws.com/${bucket}/smoke.bin`, { method: 'PUT', body: 'f'.repeat(S3_OBJECT_BYTES) }, keys),
    `s3:PutObject ${bucket}/smoke.bin`,
  );
}

/** `dynamodb:CreateTable`, the cheapest DynamoDB resource with a real name to read back. */
async function createTable(tableName: string, keys: AccessKeys = accountKeys(ACCOUNT_A)): Promise<void> {
  await expectSeeded(
    await flociFetch(
      'dynamodb',
      'https://dynamodb.us-east-1.amazonaws.com/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'DynamoDB_20120810.CreateTable',
        },
        body: JSON.stringify({
          TableName: tableName,
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          BillingMode: 'PAY_PER_REQUEST',
        }),
      },
      keys,
    ),
    `dynamodb:CreateTable ${tableName}`,
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
  await expectSeeded(
    await flociFetch('rds', `https://rds.us-east-1.amazonaws.com/?${params.toString()}`, { method: 'POST' }, keys),
    `rds:CreateDBInstance ${identifier}`,
  );
}

export { createBucketWithObject, createDbInstance, createRole, createTable };
