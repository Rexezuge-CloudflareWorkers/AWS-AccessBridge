/**
 * Floci harness — the LocalStack-compatible AWS emulator on `127.0.0.1:4566`.
 *
 * Why this tier exists: every other suite in this repo feeds our AWS clients a
 * hand-written stub body. A stub cannot tell us that AWS's real response no
 * longer matches the regexes in `provider-clients`. These tests put the real
 * parsers in front of a real signed-HTTP round trip.
 *
 * **No production code changes.** Every client and collector already takes an
 * `AwsClientFactory` in its constructor, so the endpoint rewrite is injected
 * through that seam: `flociClientFactory` returns the stock signing factory
 * wrapped in something that swaps the request origin on the way out. The
 * endpoints stay hardcoded to `*.amazonaws.com` in production, which is the
 * point — a smoke test must not become a second way to configure the Worker.
 */
import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { defaultAwsClientFactory } from '@aws-access-bridge/provider-clients/aws';
import type { AwsClientFactory, AwsClientOptions, AwsSignedClient } from '@aws-access-bridge/provider-clients/aws';

/**
Where the emulator is expected. Overridable so CI can move the port.
*/
const FLOCI_ENDPOINT: string = process.env.FLOCI_ENDPOINT ?? 'http://127.0.0.1:4566';

/**
Emulator boot budget. Floci starts in milliseconds; this only absorbs pull time.
*/
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

/**
How to start the emulator, quoted verbatim in the probe's failure message.
*/
const START_HINT: string = 'docker run --rm -p 4566:4566 floci/floci:latest';

/**
 * Floci treats a 12-character access key id as an account id and scopes IAM per
 * account, so distinct 12-digit keys give genuinely distinct principals. That is
 * what makes the two-hop chain test meaningful: the two roles are separate
 * principals rather than two names in one namespace, and the second hop is only
 * reachable by presenting the first hop's session credentials.
 */
const ACCOUNT_A = '111111111111';
const ACCOUNT_B = '222222222222';
const SECRET = 'floci-smoke-secret';

/**
Throwaway credentials for one Floci account. No session token: these are the chain's leaf.
*/
function accountKeys(accessKeyId: string): AccessKeys {
  return { accessKeyId, secretAccessKey: SECRET };
}

/**
 * Point a client factory at the emulator.
 *
 * Only the origin is swapped. Path and query survive verbatim, which is what
 * makes this work for every surface without a per-service path-style or
 * host-prefix special case — `lambda.us-east-1.amazonaws.com/2015-03-31/functions`
 * becomes `127.0.0.1:4566/2015-03-31/functions`, and S3's global
 * `s3.amazonaws.com/` becomes the edge root.
 *
 * The rewrite happens **before** signing, so the signature covers the emulator's
 * host, and `options.service` is untouched — Floci routes on the credential scope
 * in the `Authorization` header, exactly as LocalStack does.
 */
function flociClientFactory(endpoint: string = FLOCI_ENDPOINT): AwsClientFactory {
  const base: URL = new URL(endpoint);
  return (options: AwsClientOptions): AwsSignedClient => {
    const signed: AwsSignedClient = defaultAwsClientFactory(options);
    return {
      fetch: (url: string, init?: RequestInit): Promise<Response> => {
        const target: URL = new URL(url);
        return signed.fetch(`${base.origin}${target.pathname}${target.search}`, init);
      },
    };
  };
}

/**
 * A signed call against the emulator, for seeding state the suite then reads
 * back through the production code paths.
 *
 * Built on the stock factory so seeding exercises the same signing code the app
 * does; routing still comes from the credential scope.
 */
async function flociFetch(
  service: string,
  awsUrl: string,
  init: RequestInit = {},
  keys: AccessKeys = accountKeys(ACCOUNT_A),
  region = 'us-east-1',
): Promise<Response> {
  const client: AwsSignedClient = flociClientFactory()({ service, region, keys });
  return client.fetch(awsUrl, init);
}

export {
  ACCOUNT_A,
  ACCOUNT_B,
  FLOCI_ENDPOINT,
  READY_POLL_MS,
  READY_TIMEOUT_MS,
  SECRET,
  START_HINT,
  accountKeys,
  flociClientFactory,
  flociFetch,
};
