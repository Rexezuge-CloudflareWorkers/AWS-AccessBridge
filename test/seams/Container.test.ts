import { describe, it, expect } from 'vitest';
import { Container } from '@aws-access-bridge/backend-runtime/di';

describe('Container', () => {
  it('resolves bound values', () => {
    const scope = new Container();
    scope.bindValue('num' as never, 41);
    expect(scope.get('num' as never)).toBe(41);
    expect(scope.has('num' as never)).toBe(true);
  });

  it('memoizes factory singletons per scope', () => {
    const scope = new Container();
    let calls = 0;
    scope.bind('svc' as never, () => ({ id: ++calls }));
    const first = scope.get<{ id: number }>('svc' as never);
    const second = scope.get<{ id: number }>('svc' as never);
    expect(first).toBe(second);
    expect(first.id).toBe(1);
  });

  it('resolve() creates fresh instances without memoizing', () => {
    const scope = new Container();
    let calls = 0;
    scope.bind('svc' as never, () => ({ id: ++calls }));
    expect(scope.resolve<{ id: number }>('svc' as never).id).toBe(1);
    expect(scope.resolve<{ id: number }>('svc' as never).id).toBe(2);
    expect(scope.get<{ id: number }>('svc' as never).id).toBe(3);
  });

  it('throws for unbound tokens', () => {
    const scope = new Container();
    expect(() => scope.get('missing' as never)).toThrow('DI container has no binding for token');
    expect(scope.has('missing' as never)).toBe(false);
  });

  it('createChild inherits bindings but isolates singletons', () => {
    const parent = new Container();
    let calls = 0;
    parent.bind('svc' as never, () => ({ id: ++calls }));
    const child = parent.createChild();
    expect(child.has('svc' as never)).toBe(true);
    expect(child.get<{ id: number }>('svc' as never).id).toBe(1);
    expect(parent.get<{ id: number }>('svc' as never).id).toBe(2);
  });
});
