/**
 * One readiness probe for the whole run, in Node before any test file starts.
 *
 * This lives in `globalSetup` rather than a `beforeAll` per file on purpose:
 * Vitest gives each file its own module registry, so a memoized probe would not
 * be shared, and a missing emulator would burn the timeout four times over
 * before the first useful error. Throwing here fails the run immediately.
 */
import type { TestProject } from 'vitest/node';
import { StsService } from '@aws-access-bridge/backend-services/aws';
import { ACCOUNT_A, FLOCI_ENDPOINT, READY_POLL_MS, READY_TIMEOUT_MS, SECRET, START_HINT, flociClientFactory } from './helpers/floci';

/**
 * Probe with `sts:GetCallerIdentity` rather than a bare HTTP ping.
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
 * The two failures are reported separately because they need different fixes: a
 * refused connection means "start the emulator", while a wrong-but-responsive
 * service means "something else owns the port".
 */
async function waitForFloci(): Promise<void> {
  const deadline: number = Date.now() + READY_TIMEOUT_MS;
  const service = new StsService(flociClientFactory());
  let lastReachable: string | null = null;

  while (Date.now() < deadline) {
    try {
      const identity = await service.validateCredentials(ACCOUNT_A, SECRET);
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
      : `${FLOCI_ENDPOINT} is answering but did not return a usable STS GetCallerIdentity (${lastReachable}). ` +
        `Another AWS emulator, or an unrelated process, already owns that port.`;
  throw new Error(`Floci is not usable after ${READY_TIMEOUT_MS / 1000}s: ${detail}\nStart it with: ${START_HINT}`);
}

export default function setupGlobal(_project: TestProject): Promise<void> {
  return waitForFloci();
}
