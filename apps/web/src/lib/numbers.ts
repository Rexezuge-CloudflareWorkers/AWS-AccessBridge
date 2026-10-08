interface PositiveNumberOptions {
  /**
  Reject a fractional value (a duration in whole seconds).
  */
  integer?: boolean;
  /**
  Inclusive lower bound; defaults to "greater than zero".
  */
  min?: number;
  /**
  Inclusive upper bound.
  */
  max?: number;
}

/**
 * Parses a form field into a strictly positive finite number, or `null`.
 *
 * `Number('abc')` is `NaN`, `Number('')` is `0`, and `Number('-5')` is `-5` — and
 * `JSON.stringify(NaN)` is `null`, so the old `Number(field)` at the call site
 * sent the API a `null` threshold or a negative duration for it to reject with a
 * message about the wire format. `null` here means the caller shows its own
 * client-side error and sends nothing.
 *
 * `'0'` is rejected: the threshold schema is `positive()`, and a zero-second
 * session is meaningless. A `min` below 1 can re-admit fractional values, but
 * never zero or less.
 */
function parsePositiveNumber(raw: string, options: PositiveNumberOptions = {}): number | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    return null;
  }
  if (options.min !== undefined && value < options.min) {
    return null;
  }
  return options.max !== undefined && value > options.max ? null : value;
}

export type { PositiveNumberOptions };
export { parsePositiveNumber };
