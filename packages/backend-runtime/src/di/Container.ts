type Factory<T> = (container: Container) => T;

// Branded token so `scope.get(Tokens.X)` infers `X` without an explicit
// generic at call sites. The brand is optional (and `unknown`-compatible) so
// `Token<Service>` remains assignable to `Token<unknown>` for Map storage.
type Token<T = unknown> = (string | symbol) & { readonly __type?: T };

/**
 * Minimal dependency-injection container (Factory + Singleton scopes).
 *
 * Replaces the previous convention of `XFactory.create(env)` scattered
 * across 12+ call sites. Services declare constructor dependencies on
 * interfaces; composition roots (API worker, cron worker, tests) wire
 * concrete implementations once.
 *
 * Previously N scattered `*Factory.create(env)` call sites constructed
 * services inline per request with no memoization (notably
 * `AES_ENCRYPTION_KEY_SECRET.get()`); this container memoizes singletons
 * per scope so keys are fetched once per request.
 */
class Container {
  private readonly factories = new Map<Token<unknown>, Factory<unknown>>();
  private readonly singletons = new Map<Token<unknown>, unknown>();

  public bind<T>(token: Token<T>, factory: Factory<T>): this {
    this.factories.set(token, factory);
    return this;
  }

  public bindValue<T>(token: Token<T>, value: T): this {
    this.singletons.set(token, value);
    return this;
  }

  public has<T>(token: Token<T>): boolean {
    return this.singletons.has(token) || this.factories.has(token);
  }

  public get<T>(token: Token<T>): T {
    if (this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`DI container has no binding for token: ${String(token)}`);
    }
    const instance = (factory as Factory<T>)(this);
    this.singletons.set(token, instance);
    return instance;
  }

  /**
   * Resolve without memoizing — for request-scoped objects.
   */
  public resolve<T>(token: Token<T>): T {
    const factory = this.factories.get(token);
    if (!factory) {
      return this.get(token);
    }
    return (factory as Factory<T>)(this);
  }

  public createChild(): Container {
    const child = new Container();
    for (const [token, value] of this.singletons) {
      child.bindValue(token, value);
    }
    for (const [token, factory] of this.factories) {
      child.bind(token, factory);
    }
    return child;
  }
}

export { Container };
export type { Factory, Token };
