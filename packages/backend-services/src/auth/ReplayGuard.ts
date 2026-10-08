import { log } from '@aws-access-bridge/shared/utils';

/**
 * Single-use enforcement for HMAC-signed internal requests.
 *
 * A signature plus a timestamp proves the request was *authored* by someone
 * holding the secret, not that it is the first time it has been presented. The
 * handler's ±`INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS` check bounds how
 * long a captured request stays replayable, but every request inside that window
 * is still replayable — and `authenticateApiIdentity` trusts the
 * `X-Internal-User-Email` header on it, so one captured fan-out call can be
 * re-run as that user.
 *
 * This closes that gap with a KV-backed seen-set: a signature is recorded on
 * acceptance and rejected on a second presentation. KV is the right store because
 * the guard needs a short-lived, write-once, globally-keyed record and nothing
 * transactional — a lost write fails toward accepting a replay rather than
 * rejecting a legitimate call, which is the correct direction for an
 * availability-sensitive auth check.
 *
 * The key is the signature itself rather than a separate nonce, so it requires no
 * change to the signing side: `InternalRequestHelper` would have to emit and
 * carry a nonce, and every request signed before this guard existed has no nonce
 * to record.
 */

const REPLAY_NAMESPACE: string = 'RP';

/**
 * Retention for a recorded signature.
 *
 * Must exceed the replay window, or a signature could age out and be replayable
 * again inside a window that is still open. The handler's configured window is
 * the floor; this is a generous multiple of the default so raising the window
 * does not silently outrun the TTL.
 */
const REPLAY_TTL_SECONDS: number = 300;

class ReplayGuard {
  constructor(
    private readonly kv: KVNamespace | undefined,
    private readonly ttlSeconds: number = REPLAY_TTL_SECONDS,
  ) {}

  /**
   * Record a signature, reporting whether it is the first time it has been seen.
   *
   * @returns `true` when the signature is new and the request may proceed;
   * `false` when it has already been accepted.
   *
   * Best-effort by design. A missing binding, or a read that fails, returns
   * `true`: the timestamp window still bounds replay, so degrading to
   * "accept" keeps the internal surface available rather than turning a KV
   * outage into a total loss of `/api/*` self-calls. The failure is logged so it
   * is visible rather than silent.
   */
  public async claim(signature: string): Promise<boolean> {
    if (!this.kv) {
      return true;
    }
    const key: string = `${REPLAY_NAMESPACE}:${signature}`;
    try {
      // `expirationTtl` makes the record self-expiring, so the namespace needs no
      // sweep. `get` returning a value is the replay signal.
      const existing: unknown = await this.kv.get(key, 'text');
      if (existing !== null) {
        return false;
      }
      await this.kv.put(key, '1', { expirationTtl: this.ttlSeconds });
      return true;
    } catch (error: unknown) {
      // The message only, never the error's stack: a KV error can quote the key,
      // which is the HMAC signature.
      log.error('HMAC replay guard failed open; relying on the timestamp window', { error });
      return true;
    }
  }
}

export { REPLAY_TTL_SECONDS, ReplayGuard };
