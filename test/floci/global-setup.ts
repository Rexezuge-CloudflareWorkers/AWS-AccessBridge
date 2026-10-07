/**
 * One readiness probe for the whole run, in Node before any test file starts.
 *
 * This lives in `globalSetup` rather than a `beforeAll` per file on purpose:
 * Vitest gives each file its own module registry, so a memoized probe would not
 * be shared, and a missing emulator would burn the timeout four times over
 * before the first useful error. Throwing here fails the run immediately.
 */
import type { TestProject } from 'vitest/node';
import { awsQueryRequest } from '@aws-access-bridge/provider-clients/aws';
import { StsService } from '@aws-access-bridge/backend-services/aws';
import {
  ACCOUNT_A,
  FLOCI_ENDPOINT,
  READY_POLL_MS,
  READY_TIMEOUT_MS,
  SECRET,
  START_HINT,
  accountKeys,
  flociClientFactory,
  flociFetch,
} from './helpers/floci';
import { createDbInstance } from './helpers/seed';

/**
 * Probe with `sts:GetCallerIdentity` rather than a bare HTTP ping, then warm
 * every collector path the suite exercises.
 *
 * A ping only proves *something* answers on the port. A stale LocalStack, an
 * unrelated dev server, or a leftover process on 4566 all answer 200 — and then
 * every test fails deep inside a parser with "unable to parse temporary
 * credentials", which points at our regexes when the real problem is one process
 * occupying a port. `GetCallerIdentity` is the check Floci's own docs recommend
 * for exactly this, it is the cheapest AWS-shaped call there is, and running it
 * through `StsService` means the probe itself is production code, so a probe that
 * passes is also a first, tiny exercise of the thing under test.
 *
 * Warming matters because this file runs first. `collectors.test.ts` was the
 * file that paid the emulator's cold-start cost: one red run showed the RDS test
 * timing out at 30s while the EC2 test in the same file took 16.5s and every
 * later file answered in milliseconds. STS readiness alone does not warm the
 * RDS/EC2/Lambda/S3 handlers, so the first test to touch each one paid its lazy
 * init inside a 30s test budget. Paying it here moves it under the 90s hook
 * budget instead, where a slow emulator still has room to report usefully.
 *
 * The failure text names all three ways this can go wrong, because from outside
 * the container they look alike, and the third was mistaken for the second while
 * this was being built:
 *
 * 1. nothing listening — the container never came up, or the port is unbound;
 * 2. something listening that is not an AWS emulator;
 * 3. an emulator that answered *successfully* with a body we cannot parse. That
 *    is the subtle one: Floci replies `HTTP 204` with an empty body to a
 *    Query-protocol call whose parameters are in the query string, `204` is
 *    `response.ok`, and the caller fails later with a parse error naming the
 *    response rather than the request.
 */
async function warmEmulatorPaths(): Promise<void> {
  // The write path first: `CreateDBInstance` is a different handler from
  // `DescribeDBInstances`, so warming the read does not warm the seed. A fixed
  // name keeps a long-lived local emulator from accumulating one warmup record
  // per run — the seed tolerates `DBInstanceAlreadyExists`, so the second run
  // just reuses it, and the RDS test finds its own instance by name regardless.
  await createDbInstance('floci-warmup-db');

  // One read per collector surface, mirroring the request shapes the collectors
  // send. Bodies are consumed so the body-read path warms alongside the handler.
  const rdsDescribe = awsQueryRequest(
    'https://rds.us-east-1.amazonaws.com/',
    new URLSearchParams({ Action: 'DescribeDBInstances', Version: '2014-10-31' }),
  );
  const ec2Describe = awsQueryRequest(
    'https://ec2.us-east-1.amazonaws.com/',
    new URLSearchParams({ Action: 'DescribeInstances', Version: '2016-11-15' }),
  );
  const reads: Array<{ init?: RequestInit; service: string; url: string }> = [
    { init: rdsDescribe.init, service: 'rds', url: rdsDescribe.url },
    { init: ec2Describe.init, service: 'ec2', url: ec2Describe.url },
    { service: 'lambda', url: 'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions' },
    { service: 's3', url: 'https://s3.amazonaws.com/?list-type=2' },
  ];
  for (const read of reads) {
    const response: Response = await flociFetch(read.service, read.url, read.init ?? {}, accountKeys(ACCOUNT_A));
    const body: string = await response.text();
    if (!response.ok) {
      throw new Error(`${read.service} warmup read failed: HTTP ${response.status} ${response.statusText}\n${body.slice(0, 500)}`);
    }
  }
}

async function waitForFloci(): Promise<void> {
  const deadline: number = Date.now() + READY_TIMEOUT_MS;
  const service = new StsService(flociClientFactory());
  let lastReachable: string | null = null;

  while (Date.now() < deadline) {
    try {
      const identity = await service.validateCredentials(ACCOUNT_A, SECRET);
      await warmEmulatorPaths();
      process.stdout.write(`[floci] sts:GetCallerIdentity answered for account ${identity.accountId}\n`);
      return;
    } catch (error: unknown) {
      // `TypeError: fetch failed` is Node's refused/reset connection, i.e.
      // nothing is listening yet. Anything else means the port answered.
      lastReachable = error instanceof TypeError ? null : error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  const detail: string =
    lastReachable === null
      ? `nothing is listening on ${FLOCI_ENDPOINT}. Either the container never came up — "Failed to initialize ` +
        `container" from GitHub means the image's own health check failed, not that the image is broken — or ` +
        `nothing is bound to that port.`
      : `${FLOCI_ENDPOINT} answered but did not return a usable STS GetCallerIdentity (${lastReachable}). Either ` +
        `it is not an AWS emulator — another one, or an unrelated process, may own that port — or it is an ` +
        `emulator that replied successfully with a body this client cannot parse, which is what a Query-protocol ` +
        `call with its parameters in the query string looks like from here.`;
  throw new Error(`Floci is not usable after ${READY_TIMEOUT_MS / 1000}s: ${detail}\nStart it with: ${START_HINT}`);
}

export default function setupGlobal(_project: TestProject): Promise<void> {
  return waitForFloci();
}
