import { BadGatewayError } from '@aws-access-bridge/backend-errors';

/**
 * Default ceiling on one signed AWS call, body included.
 *
 * Without a deadline a hung AWS endpoint never settles, and the caller waits on
 * it forever — in the cron Durable Object that wedges the in-memory `currentRun`
 * guard, so every later tick answers `already_running`. 20s is far above a
 * healthy STS / Cost Explorer / list call (hundreds of ms) and well below
 * anything a request or a cron tick can usefully wait for.
 *
 * The deadline is absolute, so it also bounds `aws4fetch`'s own internal 5xx/429
 * retry loop rather than restarting for each attempt.
 */
const DEFAULT_AWS_FETCH_TIMEOUT_MS = 20_000;

/**
 * Statuses a `Response` may not carry a body for.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * Run one fetch under a deadline, mapping expiry to a clear, typed error.
 *
 * `send` receives the init to use (the caller's, plus the combined abort
 * signal). The body is read **inside** the deadline and handed back as a fresh
 * `Response`: a server that sends headers and then stalls would otherwise
 * escape the timeout and hang at the caller's `response.text()`, outside any
 * place that could name the cause. AWS bodies here are small, so buffering is
 * cheap.
 *
 * Expiry becomes `BadGatewayError` (502, retryable) rather than the platform's
 * `DOMException`, which carries no service name and is not part of the
 * `IServiceError` taxonomy every response mapper understands. A caller-supplied
 * `signal` that aborts first is rethrown unchanged — that is the caller's own
 * decision, not an upstream fault.
 *
 * The deadline is enforced by racing the work against a local timer, not only by
 * handing `send` an abort signal: the bound then holds for any `send`, including
 * one that stalls mid-body, rather than depending on the platform's `fetch`
 * honouring the signal. `test/integration/api/FetchTimeout.int.test.ts` runs it
 * under workerd; `test/seams/FetchHttpClientTimeout.test.ts` covers the Node-side
 * wiring.
 */
async function fetchWithTimeout(
  send: (init: RequestInit) => Promise<Response>,
  init: RequestInit | undefined,
  target: string,
  timeoutMs: number = DEFAULT_AWS_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeout: AbortSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal: AbortSignal | null | undefined = init?.signal;
  const signal: AbortSignal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;

  // The deadline is enforced here, not merely requested of `send`.
  //
  // Handing `fetch` an abort signal only bounds the call if `fetch` honours it —
  // which the platform's does, but which is a property of the callee rather than
  // of this function, and one that does not hold for a stalled body or for any
  // other `send` implementation. Racing the work against our own timer makes the
  // bound unconditional: `fetchWithTimeout` settles within `timeoutMs` whatever
  // `send` does. Without it the timeout was a claim about the platform rather
  // than an invariant of this code — and a claim nothing measures is not an
  // invariant.
  let expire: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    expire = (): void => {
      reject(new BadGatewayError(`The request to ${target} timed out after ${timeoutMs}ms.`, true));
    };
  });
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => expire?.(), timeoutMs);

  try {
    // One task, both phases inside it: the body read is inside the race too, or
    // a server that sent headers and then stalled would escape the deadline and
    // hang at the caller's `response.text()`.
    const call = async (): Promise<Response> => {
      const response: Response = await send({ ...init, signal });
      const body: ArrayBuffer | null = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
      return new Response(body, { headers: response.headers, status: response.status, statusText: response.statusText });
    };
    return await Promise.race([call(), deadline]);
  } catch (error: unknown) {
    // Our own expiry is already the typed answer. Otherwise a caller-supplied
    // signal that aborts first is the caller's own decision and surfaces
    // unchanged; anything else that fails after the timer fired is the timeout,
    // whatever error shape `send` produced on its way out.
    if (error instanceof BadGatewayError) {
      throw error;
    }
    if (timeout.aborted && !callerSignal?.aborted) {
      throw new BadGatewayError(`The request to ${target} timed out after ${timeoutMs}ms.`, true);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_AWS_FETCH_TIMEOUT_MS, fetchWithTimeout };
