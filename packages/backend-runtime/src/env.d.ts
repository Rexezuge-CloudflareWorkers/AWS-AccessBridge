declare global {
  interface Env {
    AccessBridgeKV: KVNamespace;
    AccessBridgeDB: D1Database;
    // The two per-feature credential keys and the HMAC secret for internal
    // self-calls, declared in `apps/api/wrangler.template.jsonc` and the
    // generated `CloudflareEnv` as well. The two `CREDENTIAL_*` bindings were
    // missing here once, and that is exactly how a binding can exist in the
    // template, the generated types and `ServiceEnv` while being absent from
    // this fourth place with nothing reporting it.
    CREDENTIAL_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
    INTERNAL_REQUEST_HMAC_SECRET: SecretsStoreSecret;
    CRON_TASKS: DurableObjectNamespace;
    SELF: Fetcher;
    // Rate limiting in front of the auth boundary on `/api/*`: every unauthenticated
    // call used to cost a D1 audit write and a PAT lookup. Optional so local
    // development without a configured namespace keeps working; the middleware
    // treats an absent binding as fail-open, not as "allow everything forever".
    AUTH_RATE_LIMITER?: RateLimit;
    // The durable collection pipeline; CronTasksWorker fans one instance out per
    // scheduled tick instead of walking regions and accounts inside the DO request.
    COLLECTION_WORKFLOW?: Workflow;
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
    /**
     * `debug` | `info` | `warn` | `error`, defaulting to `info`.
     *
     * Installed once per isolate by the composition root
     * (`backend-services/composition/requestScope`), because the logger that
     * redacts is constructed at module scope and so cannot be handed a request's
     * `env` to read the level from. An unrecognised value clears the setting
     * rather than throwing — a typo must not cost a worker its cold start.
     *
     * Declared here, and therefore in `wrangler.template.jsonc` beside it, so
     * setting it is a compile error rather than a silent no-op. That gap is the
     * one this exists to close: the variable used to be honoured by nothing at all.
     */
    LOG_LEVEL?: string;
  }
}

export {};
