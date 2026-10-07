declare global {
  interface Env {
    AccessBridgeKV: KVNamespace;
    AccessBridgeDB: D1Database;
    // The two per-feature credential keys, plus the legacy master key they are seeded
    // from and the HMAC secret for internal self-calls. All four are declared in
    // `apps/api/wrangler.template.jsonc` and in the generated `CloudflareEnv`; the two
    // `CREDENTIAL_*` bindings were missing here, so anything typed against the global
    // `Env` rather than `ServiceEnv` could not name them at all — which is how a
    // binding can be present in the template, in the generated types and in
    // `ServiceEnv`, and absent from the fourth place with nothing reporting it.
    CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
    INTERNAL_REQUEST_HMAC_SECRET: SecretsStoreSecret;
    CRON_TASKS: DurableObjectNamespace;
    SELF: Fetcher;
    POLICY_AUD?: string;
    TEAM_DOMAIN?: string;
    DEV_AUTH_EMAIL?: string;
    // Declared non-optional because the generated `CloudflareEnv` types it as the
    // literal `"production"`, so an `Env` that omits it is not assignable where a
    // `CloudflareEnv` is expected. Every other var the template sets is optional here,
    // which is why this one was the only gap.
    ENVIRONMENT: 'production';
    MAX_TOKENS_PER_USER?: string;
    MAX_TOKEN_EXPIRY_DAYS?: string;
    PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
    AUDIT_LOG_RETENTION_DAYS?: string;
    DEMO_MODE?: string;
  }
}

export {};
