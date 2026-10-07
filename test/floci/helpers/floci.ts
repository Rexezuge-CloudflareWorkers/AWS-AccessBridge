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
Ceiling on one emulator round trip, applied by the factory below.

Every test here crosses a process boundary, and Node's `fetch` carries no timeout
of its own — a request the emulator never answers waits until Vitest's own budget
expires, which reports as `Test timed out in 30000ms` and names neither the
service nor the action. That is a bad way to learn that one emulator call went
wrong, so the deadline lives here: a hung call fails naming the service that hung,
and the test around it still has budget left to say what it was doing.

The deadline covers headers **and** the body. `fetch()` resolving only means the
headers arrived — a stalled XML/JSON body in `response.text()`/`response.json()`
would otherwise bypass the abort and still surface as the bare Vitest timeout.
The wrapped body readers share the fetch's deadline, so one round trip costs at
most this much in total rather than this much for headers plus this much again
for the body.

Not a slowness allowance. Floci answers these calls in milliseconds, so anything
past a few seconds is a wedged call rather than a slow one, and the seeds in
`seed.ts` assert on the calls they make regardless.
*/
const REQUEST_TIMEOUT_MS = 20_000;

/**
Emulator boot budget. Floci starts in milliseconds; this only absorbs pull time.
*/
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

/**
How to start the emulator, quoted verbatim in the probe's failure message.

Carries the two settings CI's service container also passes, and the tag CI pins,
so a developer's emulator is the one the suite was written against.
`FLOCI_SERVICES_RDS_MOCK` is not optional here: without it a seeded
`CreateDBInstance` reaches for Docker before falling back to metadata, and with
no socket mounted that retry path costs tens of seconds per call inside the
emulator (see `seed.ts`).
*/
const START_HINT: string = 'docker run --rm -p 4566:4566 -e FLOCI_SERVICES_RDS_MOCK=true floci/floci:2.2.0';

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
 * The named failure a wedged emulator call becomes. Built in one place so the
 * fetch abort and the body-read race report the same actionable text.
 */
function timeoutError(service: string, pathname: string, cause?: unknown): Error {
  return new Error(
    `${service} call to the emulator (${pathname}) did not answer within ` +
      `${REQUEST_TIMEOUT_MS}ms. Either the emulator is wedged, or it is not answering from the ` +
      `metadata-only RDS path this suite expects: ${START_HINT}`,
    { cause },
  );
}

/**
 * Read a response body under what is left of the round-trip deadline.
 *
 * The fetch resolving only proves the headers arrived. A body that then
 * dribbles would outlive the abort unnoticed and resurface as the bare
 * `Test timed out` the deadline exists to replace, so the body readers share
 * what is left of the same budget instead of starting a second one a stacked
 * deadline could double.
 *
 * Module-level rather than nested in the factory: the timeout race already
 * nests three functions deep, and nesting it inside the fetch as well trips
 * the nested-functions limit.
 */
async function readBodyWithDeadline<T>(
  read: () => Promise<T>,
  service: string,
  pathname: string,
  startedAt: number,
  deadline: AbortSignal,
  callerAborted: () => boolean,
): Promise<T> {
  const remainingMs: number = REQUEST_TIMEOUT_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    if (!callerAborted()) {
      throw timeoutError(service, pathname);
    }
    return read();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const onTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!callerAborted()) {
          reject(timeoutError(service, pathname));
        }
      }, remainingMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    return await Promise.race([read(), onTimeout]);
  } catch (error: unknown) {
    if (deadline.aborted && !callerAborted()) {
      if (error instanceof Error && error.message.includes('did not answer within')) {
        throw error;
      }
      throw timeoutError(service, pathname, error);
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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
 *
 * Every call also gets `REQUEST_TIMEOUT_MS`, covering the fetch **and** the body
 * read as one budget. This is the only place a wedged emulator call can be
 * named, and the service name is the one piece of context that makes the failure
 * readable: without it, a hang surfaces as a bare Vitest timeout that points at
 * whichever test happened to be running.
 */
function flociClientFactory(endpoint: string = FLOCI_ENDPOINT): AwsClientFactory {
  const base: URL = new URL(endpoint);
  return (options: AwsClientOptions): AwsSignedClient => {
    const signed: AwsSignedClient = defaultAwsClientFactory(options);
    return {
      fetch: async (url: string, init?: RequestInit): Promise<Response> => {
        const target: URL = new URL(url);
        const startedAt: number = Date.now();
        const deadline: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        // `AbortSignal.any` rather than `init.signal` alone: a caller-supplied
        // signal must still win, and it must not have to know about ours. Both
        // compose, so whichever fires first aborts the request.
        const signal: AbortSignal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        const callerAborted = (): boolean => init?.signal?.aborted ?? false;
        let response: Response;
        try {
          response = await signed.fetch(`${base.origin}${target.pathname}${target.search}`, { ...init, signal });
        } catch (error: unknown) {
          // Only *our* deadline is reported this way: a caller that aborted
          // deliberately keeps its own error, which is the one it can act on.
          if (deadline.aborted && !callerAborted()) {
            throw timeoutError(options.service, target.pathname, error);
          }
          throw error;
        }
        // The body readers share what is left of the fetch's deadline — see
        // `readBodyWithDeadline` — so one round trip costs at most one budget.
        const withBodyDeadline = <T>(read: () => Promise<T>): Promise<T> =>
          readBodyWithDeadline(read, options.service, target.pathname, startedAt, deadline, callerAborted);
        const originalText: () => Promise<string> = response.text.bind(response);
        const originalJson: () => Promise<unknown> = response.json.bind(response);
        const originalArrayBuffer: () => Promise<ArrayBuffer> = response.arrayBuffer.bind(response);
        const originalBlob: () => Promise<Blob> = response.blob.bind(response);
        response.text = (): Promise<string> => withBodyDeadline(originalText);
        response.json = (): Promise<unknown> => withBodyDeadline(originalJson);
        response.arrayBuffer = (): Promise<ArrayBuffer> => withBodyDeadline(originalArrayBuffer);
        response.blob = (): Promise<Blob> => withBodyDeadline(originalBlob);
        return response;
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
