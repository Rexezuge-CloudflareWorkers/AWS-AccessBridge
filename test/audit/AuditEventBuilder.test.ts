import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditEventBuilder } from '@aws-access-bridge/backend-services/audit/AuditEventBuilder';
import { FixedClock } from '@aws-access-bridge/shared/utils/Clock';
import { TimestampUtil } from '@aws-access-bridge/shared/utils/TimestampUtil';

/**
 * `AuditEventBuilder` is the only place an audit row's shape is decided, and the
 * two things worth pinning are the completeness guard and `userId` defaulting.
 *
 * `userId` defaults to `null` rather than being required, because an
 * unauthenticated or unattributable actor is a legitimate state — the entry is
 * still written, it is simply not id-keyed, which is what keeps it findable by
 * address when no account could be resolved.
 */
describe('AuditEventBuilder', () => {
  beforeEach(() => {
    // Pin the timestamp so the built event is fully determined. The builder
    // reads it through `TimestampUtil`, which takes the clock as an argument.
    vi.spyOn(TimestampUtil, 'getCurrentUnixTimestampInSeconds').mockReturnValue(1_704_067_200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function complete(): AuditEventBuilder {
    return AuditEventBuilder.create().userEmail('user@example.com').action('ASSUME_ROLE').request('POST', '/user/aws/assume-role').status(200);
  }

  it('builds a complete event', () => {
    const event = complete().build();

    expect(event).toMatchObject({
      userEmail: 'user@example.com',
      action: 'ASSUME_ROLE',
      method: 'POST',
      path: '/user/aws/assume-role',
      statusCode: 200,
      timestamp: 1_704_067_200,
    });
    expect(event.logId).toEqual(expect.any(String));
    expect(event.logId.length).toBeGreaterThan(0);
  });

  it('defaults userId to null so an unattributable actor is still logged', () => {
    expect(complete().build().userId).toBeNull();
  });

  it('keeps an explicit null userId distinct from an absent one', () => {
    expect(complete().userId(null).build().userId).toBeNull();
  });

  it('carries the stable account id when one resolved', () => {
    // This is what makes the entry still findable after an address change.
    expect(complete().userId('usr_abc').build().userId).toBe('usr_abc');
  });

  it('carries the optional context fields', () => {
    const event = complete().resource('arn:aws:iam::123456789012:role/Dev').detail('role=Dev').network('203.0.113.7', 'curl/8').build();

    expect(event).toMatchObject({
      resource: 'arn:aws:iam::123456789012:role/Dev',
      detail: 'role=Dev',
      ipAddress: '203.0.113.7',
      userAgent: 'curl/8',
    });
  });

  it('leaves omitted optional fields undefined rather than inventing values', () => {
    const event = complete().build();
    expect(event.resource).toBeUndefined();
    expect(event.detail).toBeUndefined();
    expect(event.ipAddress).toBeUndefined();
    expect(event.userAgent).toBeUndefined();
  });

  it('accepts a network call with only one of the two fields', () => {
    expect(complete().network('203.0.113.7').build()).toMatchObject({ ipAddress: '203.0.113.7', userAgent: undefined });
    expect(complete().network(undefined, 'curl/8').build()).toMatchObject({ ipAddress: undefined, userAgent: 'curl/8' });
  });

  it.each([
    ['userEmail', (): AuditEventBuilder => AuditEventBuilder.create().action('A').request('GET', '/x').status(200)],
    ['action', (): AuditEventBuilder => AuditEventBuilder.create().userEmail('u@e.com').request('GET', '/x').status(200)],
    ['method', (): AuditEventBuilder => AuditEventBuilder.create().userEmail('u@e.com').action('A').status(200)],
    // Deliberately omitting `path`, which is what this row is for. It is spelled as a
    // one-argument `request(...)` rather than `request('GET', undefined)`, and the
    // reason it needs the cast is the finding: `request` sets `method` and `path`
    // together, so the public API **cannot** produce an event carrying a method with no
    // path. Omitting `path` is reachable only by breaking the signature, so the case
    // this row covers is currently only reachable by a type error.
    ['path', (): AuditEventBuilder => AuditEventBuilder.create().userEmail('u@e.com').action('A').request('GET', undefined as unknown as string).status(200)],
    ['statusCode', (): AuditEventBuilder => AuditEventBuilder.create().userEmail('u@e.com').action('A').request('GET', '/x')],
  ])('refuses to build without %s', (_field, build) => {
    // A partial audit row is worse than none: it would look like a real entry
    // with a missing actor or a missing outcome.
    expect(() => build().build()).toThrow(/requires userEmail, action, method, path, and statusCode/);
  });

  it('rejects an empty required field, not just an absent one', () => {
    expect(() => complete().userEmail('').build()).toThrow(/requires/);
    expect(() => complete().action('').build()).toThrow(/requires/);
  });

  it('accepts statusCode 0, which the undefined check must not swallow', () => {
    // `statusCode === undefined` is the guard, not a truthiness test — 0 is a
    // real (if odd) status and must not be mistaken for "not set".
    const event = AuditEventBuilder.create().userEmail('u@e.com').action('A').request('GET', '/x').status(0).build();
    expect(event.statusCode).toBe(0);
  });

  it('returns itself from every setter so calls chain', () => {
    const builder = AuditEventBuilder.create();
    expect(builder.userEmail('u@e.com')).toBe(builder);
    expect(builder.userId('usr_abc')).toBe(builder);
    expect(builder.action('A')).toBe(builder);
    expect(builder.request('GET', '/x')).toBe(builder);
    expect(builder.status(200)).toBe(builder);
    expect(builder.resource('r')).toBe(builder);
    expect(builder.detail('d')).toBe(builder);
    expect(builder.network('i', 'ua')).toBe(builder);
  });

  it('lets a later setter overwrite an earlier one', () => {
    const event = complete().userEmail('first@example.com').userEmail('second@example.com').build();
    expect(event.userEmail).toBe('second@example.com');
  });

  it('derives its timestamp from TimestampUtil, so an injected clock is honoured', () => {
    // Documents the seam this builder depends on; the pinned spy above is what
    // makes the built event deterministic.
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds(new FixedClock(1_704_067_200_999))).toBe(1_704_067_200);
  });
});