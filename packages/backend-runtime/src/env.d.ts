declare global {
  interface Env {
    AccessBridgeKV: KVNamespace;
    AccessBridgeDB: D1Database;
    AES_ENCRYPTION_KEY_SECRET: SecretsStoreSecret;
    INTERNAL_HMAC_SECRET: SecretsStoreSecret;
    CRON_TASKS: DurableObjectNamespace;
    SELF: Fetcher;
    SERVE_SPA_FROM_WORKER?: string;
    POLICY_AUD?: string;
    TEAM_DOMAIN?: string;
    DEV_AUTH_EMAIL?: string;
    MAX_TOKENS_PER_USER?: string;
    MAX_TOKEN_EXPIRY_DAYS?: string;
    PRINCIPAL_TRUST_CHAIN_LIMIT?: string;
    AUDIT_LOG_RETENTION_DAYS?: string;
    DEMO_MODE?: string;
  }
}

export {};
