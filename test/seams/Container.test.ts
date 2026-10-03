import { describe, it, expect } from 'vitest';
import { Container } from '@aws-access-bridge/backend-runtime/di';

/**
 * The container is a factory + per-scope singleton map, and `get` is the whole
 * of its public surface. `resolve` (non-memoizing), `has`, and `createChild`
 * were removed as dead: each had exactly one consumer, a test asserting it, and
 * no production caller — `requestScope.ts` uses `get` throughout, and request
 * scoping is achieved by building a fresh container per request rather than by
 * resolving non-memoized instances.
 */
describe('Container', () => {
  it('resolves bound values', () => {
    const scope = new Container();
    scope.bindValue('num' as never, 41);
    expect(scope.get('num' as never)).toBe(41);
  });

  it('memoizes factory singletons per scope', () => {
    // The memoization is the point of the container: it is what stops a secret
    // fetch (`AES_ENCRYPTION_KEY_SECRET.get()`) happening two or three times in
    // one request.
    const scope = new Container();
    let calls = 0;
    scope.bind('svc' as never, () => ({ id: ++calls }));
    const first = scope.get<{ id: number }>('svc' as never);
    const second = scope.get<{ id: number }>('svc' as never);
    expect(first).toBe(second);
    expect(first.id).toBe(1);
  });

  it('memoizes separately per scope', () => {
    // Two scopes in one request must not share singletons, or the identity memo
    // and the encryption-key chains would outlive the request they belong to.
    let calls = 0;
    const factory = (): { id: number } => ({ id: ++calls });
    const first = new Container().bind('svc' as never, factory).get<{ id: number }>('svc' as never);
    const second = new Container().bind('svc' as never, factory).get<{ id: number }>('svc' as never);
    expect(first).not.toBe(second);
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
  });

  it('throws for unbound tokens, naming the token', () => {
    // The message is the only diagnostic an operator gets from a missing
    // binding, so it must name which one.
    const scope = new Container();
    expect(() => scope.get('missing' as never)).toThrow('DI container has no binding for token');
    expect(() => scope.get('missing' as never)).toThrow('missing');
  });

  it('prefers a bound value over a factory for the same token', () => {
    const scope = new Container();
    let calls = 0;
    scope.bind('svc' as never, () => ({ id: ++calls }));
    scope.bindValue('svc' as never, { id: 99 });
    expect(scope.get<{ id: number }>('svc' as never).id).toBe(99);
  });

  it('returns false-ish for a token bound to undefined via bindValue', () => {
    // `bindValue(token, undefined)` is a legitimate way to express "resolved to
    // nothing"; the singleton map holds it, so `get` must not fall through to
    // the factory path.
    const scope = new Container();
    scope.bindValue('nothing' as never, undefined);
    expect(scope.get('nothing' as never)).toBeUndefined();
  });
});