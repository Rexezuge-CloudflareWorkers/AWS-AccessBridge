import type { ServiceEnv } from '@aws-access-bridge/backend-services/composition/ServiceEnv';

/**
 * A `ServiceEnv` for tests that exercise configuration rather than storage.
 *
 * `ServiceEnv` has exactly one required member, `AccessBridgeDB`, and everything else
 * is optional configuration. That makes a config-focused test read `{}` when it means
 * "no configuration set" — which is the interesting case — so six `AccessAuthService`
 * tests were passing partial literals like `{ DEMO_MODE: 'true' }` and being reported
 * as not assignable to `ServiceEnv`. Each needed a D1 binding it never queries.
 *
 * So the binding is supplied once here. The double answers an empty result rather than
 * throwing, because "this unit does not use D1" and "this unit fails on D1" are
 * different failures and only one of them is a defect in the test.
 */
export function serviceEnv(overrides: Partial<ServiceEnv> = {}): ServiceEnv {
  const statement = {
    bind: () => statement,
    first: async () => null,
    run: async () => ({ success: true, results: [], meta: {} }),
    all: async () => ({ success: true, results: [], meta: {} }),
    raw: async () => [],
  };

  return {
    AccessBridgeDB: {
      prepare: () => statement,
      batch: async () => [],
    } as unknown as ServiceEnv['AccessBridgeDB'],
    ...overrides,
  };
}