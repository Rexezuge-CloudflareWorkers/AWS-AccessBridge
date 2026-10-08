import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';

/**
 * Every environment member a backend service is allowed to read.
 *
 * This is the single source of truth for the service/env contract. Each
 * service declares its own `*ServiceEnv` by extending (or aliasing) this type,
 * which lets the composition root construct any service from one shared env
 * shape without casts.
 *
 * That matters because the previous arrangement required `env as never` at
 * every one of the 15 composition-root bindings: `as never` is assignable to
 * everything and therefore type-checks nothing, so a service could be wired to
 * an env missing a binding it needs and the compiler would stay silent.
 *
 * The optional string members are configuration read through
 * `ConfigurationManager`/`EnvParser`; keeping them declared here (rather than
 * behind an index signature) means a service that reaches for an undeclared
 * config key is a compile error instead of a runtime `undefined`.
 */
interface ServiceEnv {
  AccessBridgeDB: D1Queryable;
  AccessBridgeKV?: KVNamespace;

  // Encryption keys, one per encrypted surface. See `encryptionKeys.ts`.
  /**
  Long-term IAM access keys in the `credentials` D1 table.
  */
  CREDENTIAL_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;
  /**
  Temporary STS credentials in the `credentials_cache` KV namespace.
  */
  CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;

  // Raw key vars for local dev and tests, where no Secrets Store is provisioned.
  // Never set these in production — `encryptionKeys.ts` only falls back to them
  // when the Secrets Store binding is absent, not when it is broken.
  CREDENTIAL_ENCRYPTION_KEY?: string;
  CREDENTIAL_CACHE_ENCRYPTION_KEY?: string;

  // Credential chains
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_REFRESH_INTERVAL_MINUTES?: string;
  NUMBER_OF_CREDENTIALS_TO_REFRESH?: string;

  // Personal access tokens
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;

  // Cloudflare Access
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;

  // Internal HMAC-signed self-calls
  INTERNAL_REQUEST_HMAC_SECRET?: SecretsStoreSecret;

  // Auth-boundary rate limiter and the durable collection workflow. Both optional:
  // the middleware and the cron fall back to their previous behaviour when a
  // deployment has not bound them.
  //
  // There is no `SELF` here: it existed only to construct the
  // `InternalRequestHelper` this scope used to register, and nothing has resolved
  // that token since federation stopped looping back over the service binding.
  AUTH_RATE_LIMITER?: RateLimit;
  COLLECTION_WORKFLOW?: Workflow;
}

export type { ServiceEnv };
