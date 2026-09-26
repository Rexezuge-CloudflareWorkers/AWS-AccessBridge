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
  AES_ENCRYPTION_KEY_SECRET?: SecretsStoreSecret;

  // Credential chains
  PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
  CREDENTIAL_EXPIRY_BUFFER_MINUTES?: string;
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
  INTERNAL_HMAC_SECRET?: SecretsStoreSecret;
}

export type { ServiceEnv };
