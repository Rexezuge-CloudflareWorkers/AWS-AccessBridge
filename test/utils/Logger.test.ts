import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, isSecretKey, REDACTED, redactFields, redactMessage, redactValue } from '@aws-access-bridge/shared/utils/Logger';
import { resetLogLevelForTests, resolveLogLevel, setLogLevel } from '@rexezuge/runtime';
import type { LogLevel } from '@rexezuge/runtime';

/**
One captured emit, as the kit's `LogSink` port received it.
*/
interface Captured {
  level: LogLevel;
  /**
  The namespace prefix the kit prepended — empty here, as no namespace is bound.
  */
  message: string;
  /**
  The redacted message the logger passed through.
  */
  message_: unknown;
  fields: Record<string, unknown>;
}

/**
 * Redaction is the reason this module exists, so it is tested as a security
 * control rather than as a formatter. The failures it prevents are silent: a live
 * AWS session token in a retained log tail is readable by anyone with log access
 * and cannot be un-leaked.
 *
 * Both heuristics are deny-lists and therefore incomplete by construction — the
 * comments in `Logger.ts` say so rather than claiming otherwise. These tests pin
 * the cases that actually occur in this codebase.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSecretKey', () => {
  it('matches the key names this codebase actually uses', () => {
    for (const key of ['secretAccessKey', 'sessionToken', 'accessToken', 'INTERNAL_REQUEST_HMAC_SECRET', 'credential', 'password']) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it('matches case-insensitively and as a substring', () => {
    // A new secret-shaped field must not slip through by being spelled differently.
    expect(isSecretKey('awsSecretAccessKey')).toBe(true);
    expect(isSecretKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
  });

  it('leaves diagnostic fields alone', () => {
    for (const key of ['principalArn', 'region', 'status', 'resourceType', 'count', 'error', 'runId']) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });

  it('does not match a bare key name that merely contains an auth-ish substring', () => {
    // Guards against over-redaction turning every diagnostic useless. `author`
    // alone carries no secret.
    expect(isSecretKey('author')).toBe(false);
    expect(isSecretKey('authorArn')).toBe(false);
  });
});

describe('redactFields', () => {
  it('redacts by key name', () => {
    expect(redactFields({ principalArn: 'arn:aws:iam::1:role/Dev', secretAccessKey: 'wJalrXUt' })).toEqual({
      principalArn: 'arn:aws:iam::1:role/Dev',
      secretAccessKey: REDACTED,
    });
  });

  it('redacts regardless of value length, so a secret leaks no size information', () => {
    expect(redactFields({ token: 'a' }).token).toBe(REDACTED);
  });

  it('recurses into nested objects', () => {
    expect(redactFields({ outer: { sessionToken: 'tok', region: 'us-east-1' } })).toEqual({
      outer: { region: 'us-east-1', sessionToken: REDACTED },
    });
  });

  it('recurses into arrays', () => {
    expect(redactFields({ keys: [{ secretAccessKey: 'shh' }] })).toEqual({ keys: [{ secretAccessKey: REDACTED }] });
  });

  it('reduces an Error to its message', () => {
    // A stack trace can carry values a call site interpolated into the message.
    const error = new Error('boom');
    expect(redactFields({ error }).error).toBe('boom');
  });

  it('redacts a secret-shaped value even under a harmless key', () => {
    // Key matching alone would miss a secret pasted into a `detail` field.
    expect(redactFields({ detail: 'key AKIAIOSFODNN7EXAMPLE rejected' }).detail).toBe(`key ${REDACTED} rejected`);
  });
});

describe('redactValue', () => {
  it('redacts AWS access key IDs', () => {
    expect(redactValue('using AKIAIOSFODNN7EXAMPLE now')).toBe(`using ${REDACTED} now`);
    // Temporary credentials use the ASIA prefix and are the common case here.
    expect(redactValue('ASIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
  });

  it('redacts JWTs', () => {
    // All three segments must be long enough to match; a truncated JWT is not a
    // JWT and redacting one would be pattern-matching noise.
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redactValue(jwt)).toBe(REDACTED);
    expect(redactValue(`Bearer ${jwt}`)).toBe(`Bearer ${REDACTED}`);
  });

  it('redacts hex digests, which is what a HMAC signature looks like', () => {
    expect(redactValue('sig ' + 'a'.repeat(64))).toBe(`sig ${REDACTED}`);
  });

  it('leaves ordinary text alone', () => {
    expect(redactValue('Failed to refresh arn:aws:iam::123456789012:role/Dev')).toBe(
      'Failed to refresh arn:aws:iam::123456789012:role/Dev',
    );
  });

  it('leaves non-string scalars alone', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
  });
});

describe('redactMessage', () => {
  it('scrubs a secret interpolated into the message text', () => {
    // The other half of the leak surface: call sites interpolate freely, so the
    // message needs scrubbing as well as the field bag.
    expect(redactMessage('refresh failed for AKIAIOSFODNN7EXAMPLE')).toBe(`refresh failed for ${REDACTED}`);
  });

  it('leaves a plain message untouched', () => {
    expect(redactMessage('cost collection finished')).toBe('cost collection finished');
  });
});

describe('createLogger', () => {
  /**
   * Capture at the kit's `LogSink` port rather than spying on `console`.
   *
   * The port is where the kit hands over the level, the prefixed message and the
   * arguments, so a suite asserts exactly what would have been written without
   * standing a console spy in for the log tail — and it gets the same seam
   * production does, so a change to the emit path is exercised here rather than
   * only in production.
   */
  function capture(): { calls: Captured[]; logger: ReturnType<typeof createLogger> } {
    const calls: Captured[] = [];
    return {
      calls,
      logger: createLogger({}, (level, message, args) => {
        calls.push({ level, message, message_: args[0], fields: args[1] as Record<string, unknown> });
      }),
    };
  }

  it('emits at or above the floor, and debug is reachable by raising it', () => {
    // The level decision is the kit's, and it is the change this convergence
    // makes: the copy this replaces deliberately emitted `debug` unconditionally,
    // on the grounds that a filter nobody controls swallows diagnostics. The
    // answer to that is not "no filter" but "a filter that can be turned up" —
    // `LOG_LEVEL=debug` is wired at the composition root, so the diagnostic is one
    // variable away rather than absent.
    const { calls, logger } = capture();
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(calls.map((call) => call.level)).toEqual(['info', 'warn', 'error']);

    resetLogLevelForTests();
    setLogLevel('debug');
    try {
      logger.debug('now visible');
      expect(calls.map((call) => call.level)).toEqual(['info', 'warn', 'error', 'debug']);
    } finally {
      resetLogLevelForTests();
    }
  });

  it('ignores an unrecognised LOG_LEVEL rather than throwing at a cold start', () => {
    // A typo in configuration must not cost a worker its cold start.
    resetLogLevelForTests();
    setLogLevel('verbose');
    expect(resolveLogLevel()).toBe('info');
    resetLogLevelForTests();
  });

  it('redacts before the sink, so a call site that forgets still cannot leak', () => {
    // This is the property that makes the control worth having: the guarantee is
    // enforced once, on the way into the sink, rather than relying on every call
    // site. Both halves are scrubbed — the key name and the value shape.
    const { calls, logger } = capture();
    logger.error('boom', { secretAccessKey: 'wJalrXUtnFEMI', principalArn: 'arn:aws:iam::1:role/Dev' });
    expect(calls[0].fields).toEqual({ principalArn: 'arn:aws:iam::1:role/Dev', secretAccessKey: REDACTED });
    expect(calls[0].message_).toBe('boom');
  });

  it('scrubs a secret interpolated into the message itself', () => {
    // The other half of the leak surface: call sites interpolate freely, so the
    // text needs the same treatment as the field bag.
    const { calls, logger } = capture();
    logger.error('refresh failed for AKIAIOSFODNN7EXAMPLE');
    expect(calls[0].message_).toContain(REDACTED);
    expect(calls[0].message_).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('binds context fields and lets a call site override them', () => {
    const calls: Captured[] = [];
    const scoped = createLogger({ subsystem: 'collector', region: 'us-east-1' }, (level, message, args) => {
      calls.push({ level, message, message_: args[0], fields: args[1] as Record<string, unknown> });
    });
    scoped.warn('partial');
    scoped.warn('overridden', { region: 'eu-west-1' });
    expect(calls[0].fields).toEqual({ region: 'us-east-1', subsystem: 'collector' });
    // Per-call wins, or a context key could silently relabel a diagnostic.
    expect(calls[1].fields).toEqual({ region: 'eu-west-1', subsystem: 'collector' });
  });

  it('tolerates a circular field bag rather than throwing while reporting a failure', () => {
    // A logger that throws while reporting a failure is worse than one that degrades.
    const circular: Record<string, unknown> = { principalArn: 'arn:aws:iam::1:role/Dev' };
    circular.self = circular;
    const { calls, logger } = capture();
    expect(() => {
      logger.error('boom', circular);
    }).not.toThrow();
    expect(calls).toHaveLength(1);
    // The cycle is broken rather than followed: the revisit is summarised rather
    // than recursed into, so the structure terminates before the serialiser's own
    // guard is reached.
    const fields = calls[0].fields as { self: { self: { note: string } } };
    expect(fields.self.self.note).toBe('[CIRCULAR]');
  });
});
