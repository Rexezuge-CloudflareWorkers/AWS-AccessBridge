import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, isSecretKey, REDACTED, redactFields, redactMessage, redactValue } from '@aws-access-bridge/shared/utils/Logger';

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
    expect(redactValue('Failed to refresh arn:aws:iam::123456789012:role/Dev')).toBe('Failed to refresh arn:aws:iam::123456789012:role/Dev');
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
  function capture(): { calls: Array<[string, string, unknown]>; sink: ReturnType<typeof createLogger> } {
    const calls: Array<[string, string, unknown]> = [];
    const sink = (level: string, message: string, fields: Record<string, unknown>): void => {
      calls.push([level, message, fields]);
    };
    return { calls, sink: createLogger({}, sink) };
  }

  it('emits one call per level', () => {
    const { calls, sink } = capture();
    sink.debug('d');
    sink.info('i');
    sink.warn('w');
    sink.error('e');
    expect(calls.map(([level]) => level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('redacts at the sink, so a call site that forgets still cannot leak', () => {
    // This is the property that makes the control worth having: the guarantee is
    // enforced once, at the boundary, rather than relying on 47 call sites.
    const { calls, sink } = capture();
    sink.error('boom', { secretAccessKey: 'wJalrXUtnFEMI', principalArn: 'arn:aws:iam::1:role/Dev' });
    expect(calls[0][2]).toEqual({ principalArn: 'arn:aws:iam::1:role/Dev', secretAccessKey: REDACTED });
  });

  it('binds context fields and lets a call site override them', () => {
    const calls: Array<[string, string, unknown]> = [];
    const sink = (level: string, message: string, fields: Record<string, unknown>): void => {
      calls.push([level, message, fields]);
    };
    const scoped = createLogger({ subsystem: 'collector', region: 'us-east-1' }, sink);
    scoped.warn('partial');
    scoped.warn('overridden', { region: 'eu-west-1' });
    expect(calls[0][2]).toEqual({ region: 'us-east-1', subsystem: 'collector' });
    // Per-call wins, or a context key could silently relabel a diagnostic.
    expect(calls[1][2]).toEqual({ region: 'eu-west-1', subsystem: 'collector' });
  });

  it('tolerates a circular field bag rather than throwing while reporting a failure', () => {
    const circular: Record<string, unknown> = { principalArn: 'arn:aws:iam::1:role/Dev' };
    circular.self = circular;
    const { calls, sink } = capture();
    // A logger that throws while reporting a failure is worse than one that degrades.
    expect(() => {
      sink.error('boom', circular);
    }).not.toThrow();
    expect(calls).toHaveLength(1);
  });
});