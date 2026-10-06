
/**
 * Structured logging with mandatory redaction.
 *
 * Two reasons this exists rather than leaving `console.*` in place:
 *
 * 1. **Redaction is the point.** Every surface here handles AWS `SecretAccessKey`,
 *    `SessionToken`, personal access tokens and HMAC secrets. A log line that
 *    interpolates an error object or a credential object can put a live secret in
 *    a log tail — which is retained, shipped to observability, and readable by
 *    anyone with log access. The reference repos hit this too, which is why one of
 *    them logs token-adjacent failures *without* the error text.
 * 2. **Structured fields survive aggregation.** A message with a principal ARN
 *    baked into the string cannot be grouped by ARN in a log tail.
 *
 * The redaction is applied at the sink, not at the call site, so a future call site
 * that forgets cannot leak. It is a deny-list over key names and a value-shape check
 * over the values themselves; both are heuristics, and the comments say so rather
 * than claiming completeness.
 *
 * Redaction is deliberately conservative — a redacted value is `[REDACTED]`
 * regardless of its length, so no information about a secret's size survives.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

/**
 * Keys whose value is never safe to log.
 *
 * Matched case-insensitively as a substring, so `secretAccessKey`,
 * `awsSecretAccessKey` and `SECRET` all match. Substring rather than exact
 * because the alternative is a new secret-shaped field silently slipping through.
 *
 * `'authorization'` and `'auth_token'` stand in for a bare `'auth'`: the substring
 * `auth` also occurs in `author`, `authority` and `authentication`, so listing it
 * bare would redact ordinary diagnostic fields and train everyone to ignore the
 * redaction markers.
 */
const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'token',
  'authorization',
  'auth_token',
  'authheader',
  'auth_header',
  'signature',
  'apikey',
  'api_key',
  'credential',
  'privatekey',
  'private_key',
  'sessionkey',
  'session_key',
  'cookie',
];

/**
 * Value shapes that are secret regardless of the key they arrived under — AWS
 * access key IDs (`AKIA`/`ASIA` + 16), base64 HMAC digests, and JWTs.
 *
 * Key-name matching alone would miss a value interpolated into a free-text message,
 * which is the common shape at most call sites.
 */
// Global, because `replaceAll` rejects a non-global `RegExp`. Safe to share as
// module state: it is only ever used with `replaceAll`, which resets `lastIndex`
// itself, so no position leaks between calls.
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA|AIDA|AROA|ANPA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  // All three JWT segments, with no trailing dot required — requiring one left the
  // signature segment in the log, which is the half that verifies the token.
  /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g,
  /\b[A-F0-9]{40,}\b/gi,
];

const REDACTED = '[REDACTED]';

/**
 * Whether a key name suggests its value is secret.
 *
 * Kept separate from `redactValue` so the two heuristics can be reasoned about —
 * and tested — independently.
 */
function isSecretKey(key: string): boolean {
  const lowered: string = key.toLowerCase();
  return REDACTED_KEY_FRAGMENTS.some((fragment: string): boolean => lowered.includes(fragment));
}

function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    let result: string = value;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      result = result.replaceAll(pattern, () => REDACTED);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => redactValue(entry, seen));
  }
  if (value instanceof Error) {
    // Only the message is logged. A stack trace can carry the values a call site
    // interpolated, and the message is what identifies the failure.
    return value.message;
  }
  return value && typeof value === 'object' ? redactFields(value as LogFields, seen) : value;
}

/**
 * Redact a field bag by key name.
 *
 * Nested objects and arrays recurse; an `Error` value is reduced to its message.
 *
 * `seen` breaks reference cycles. Redaction runs *before* serialisation, so a
 * circular structure — an `env` object threaded through as context is the realistic
 * way to get one — would otherwise overflow the stack here rather than reaching the
 * serialiser's own guard. A structure already visited is summarised instead.
 */
function redactFields(fields: LogFields, seen: WeakSet<object> = new WeakSet()): LogFields {
  if (seen.has(fields)) {
    return { note: '[CIRCULAR]' };
  }
  seen.add(fields);

  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSecretKey(key)) {
      safe[key] = REDACTED;
      continue;
    }
    // Arrays are fresh objects each visit, so the cycle guard is per-object rather
    // than per-path; a repeated sibling therefore reads as circular when it is not,
    // which is the safe direction to be wrong in.
    safe[key] = value && typeof value === 'object' ? redactValue(value, seen) : redactValue(value);
  }
  return safe;
}

/**
 * Render a message, scrubbing anything secret-shaped out of the text itself.
 *
 * Call sites interpolate freely (`Failed to refresh ${principalArn}`), so the
 * message is the other half of the leak surface alongside the field bag.
 */
function redactMessage(message: string): string {
  let result: string = message;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replaceAll(pattern, () => REDACTED);
  }
  return result;
}

/**
 * Serialise a field bag for the single-line output.
 *
 * `JSON.stringify` would throw on a circular structure — an env object threaded
 * through as context is the realistic way to get one — and a logger that throws
 * while reporting a failure is worse than one that degrades.
 */
function formatFields(fields: LogFields): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return JSON.stringify({ note: 'log fields were not serialisable', fieldCount: Object.keys(fields).length });
  }
}

interface Logger {
  debug(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
}

/**
 * The console-backed sink.
 *
 * One JSON object per line rather than `console.error(message, fields)`, because
 * the Workers log tail renders a trailing object poorly and the structured form is
 * what makes a field groupable. `console` is used directly rather than a level
 * filter: Cloudflare's own logging already samples, and a local `DEBUG` filter here
 * would silently swallow diagnostics in production where nobody is filtering.
 */
function consoleSink(level: LogLevel, message: string, fields: LogFields): void {
  const line: string = `[${level.toUpperCase()}] ${message}${Object.keys(fields).length > 0 ? ` ${formatFields(fields)}` : ''}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

/**
 * Build a logger, optionally bound to fixed context.
 *
 * The bound context is merged *under* per-call fields so a call site can override a
 * context key — otherwise `logger.error('...', { error })` could be silently
 * relabelled by a context entry of the same name.
 */
function createLogger(context: LogFields = {}, sink: typeof consoleSink = consoleSink): Logger {
  const log = (level: LogLevel) =>
    (message: string, fields: LogFields = {}): void => {
      sink(level, redactMessage(message), redactFields({ ...context, ...fields }));
    };
  return {
    debug: log('debug'),
    error: log('error'),
    info: log('info'),
    warn: log('warn'),
  };
}

/**
 * Process-wide default.
 *
 * Importable as `log.warn('...')` for call sites with no better context. Prefer
 * `createLogger({ ... })` where the subsystem is known — the bound fields are what
 * make a log line groupable.
 */
const log: Logger = createLogger();

export { createLogger, isSecretKey, log, redactFields, redactMessage, redactValue, REDACTED };
export type { LogFields, Logger, LogLevel };