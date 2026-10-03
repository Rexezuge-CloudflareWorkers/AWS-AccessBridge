/**
 * Time source. Injected rather than read from `Date.now()` directly so that
 * time-dependent behaviour — the internal HMAC replay window, credential-cache
 * expiry, retention pruning cutoffs — can be tested deterministically instead of
 * by racing the real clock or by asserting on `Date.now()` deltas.
 *
 * `TimestampUtil`'s current-time reads go through `SystemClock` by default;
 * pass a `FixedClock` to pin them.
 */
interface Clock {
  /**
   * Milliseconds since the Unix epoch.
   */
  now(): number;
}

/**
 * The production clock. A single shared instance — it holds no state, so there
 * is nothing to gain from more than one, and a default parameter needs a value.
 */
class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * A clock frozen at `fixedTime`, for tests. Constructed with an explicit time so
 * a test states which instant it is reasoning about rather than deriving one.
 */
class FixedClock implements Clock {
  private readonly fixedTime: number;

  constructor(fixedTime: number) {
    this.fixedTime = fixedTime;
  }

  now(): number {
    return this.fixedTime;
  }
}

/**
 * The shared production instance, for the common case where a caller wants "now"
 * without choosing a clock. Stateless, so one instance is enough.
 */
const SYSTEM_CLOCK: Clock = new SystemClock();

export type { Clock };
export { SystemClock, FixedClock, SYSTEM_CLOCK };