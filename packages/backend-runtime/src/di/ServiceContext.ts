import type { Clock, Logger } from '@aws-access-bridge/shared/utils';
import { ConsoleLogger, SystemClock } from '@aws-access-bridge/shared/utils';

/**
 * Single request-scoped context replacing the 12+ bespoke `*Env`
 * structural subsets previously passed around. Domain services accept
 * this (or a narrower options object derived from it) via constructor
 * injection instead of `new X(env)` per call.
 */
interface ServiceContext {
  readonly env: ServiceContextEnv;
  readonly logger: Logger;
  readonly clock: Clock;
}

interface ServiceContextEnv {
  // NOTE: intentionally `unknown` — backend-runtime (Layer 1) must not
  // import backend-data (Layer 2). Narrow to D1Queryable at use sites.
  AccessBridgeDB: unknown;
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  AccessBridgeKV?: KVNamespace;
  [key: string]: unknown;
}

interface ServiceContextOverrides {
  logger?: Logger;
  clock?: Clock;
}

function createServiceContext(env: ServiceContextEnv, overrides: ServiceContextOverrides = {}): ServiceContext {
  return {
    env,
    logger: overrides.logger ?? new ConsoleLogger(),
    clock: overrides.clock ?? new SystemClock(),
  };
}

export { createServiceContext };
export type { ServiceContext, ServiceContextEnv, ServiceContextOverrides };
