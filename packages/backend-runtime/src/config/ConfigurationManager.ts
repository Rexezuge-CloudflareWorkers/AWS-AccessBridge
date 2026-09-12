import {
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS,
  DEFAULT_COST_COLLECTION_INTERVAL_HOURS,
  DEFAULT_COST_LOOKBACK_DAYS,
  DEFAULT_CREDENTIAL_EXPIRY_BUFFER_MINUTES,
  DEFAULT_CREDENTIAL_REFRESH_INTERVAL_MINUTES,
  DEFAULT_DEMO_MODE,
  DEFAULT_INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS,
  DEFAULT_MAX_TOKENS_PER_USER,
  DEFAULT_MAX_TOKEN_EXPIRY_DAYS,
  DEFAULT_NUMBER_OF_CREDENTIALS_TO_REFRESH,
  DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT,
  DEFAULT_PRUNE_BATCH_SIZE,
  DEFAULT_RESOURCE_COLLECTION_INTERVAL_HOURS,
  DEFAULT_SERVE_SPA_FROM_WORKER,
} from './ConfigurationDefaults';
import { EnvParser } from './EnvParser';

class ConfigurationManager {
  // ─── Namespace groups ────────────────────────────────────────────────────────

  public static readonly credential = {
    getTrustChainLimit: (env: unknown): number =>
      EnvParser.positiveInt(env, 'PRINCIPAL_TRUST_CHAIN_LIMIT', DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT),
    getExpiryBufferMinutes: (env: unknown): number =>
      EnvParser.nonNegativeInt(env, 'CREDENTIAL_EXPIRY_BUFFER_MINUTES', DEFAULT_CREDENTIAL_EXPIRY_BUFFER_MINUTES),
    getRefreshBatchSize: (env: unknown): number =>
      EnvParser.positiveInt(env, 'NUMBER_OF_CREDENTIALS_TO_REFRESH', DEFAULT_NUMBER_OF_CREDENTIALS_TO_REFRESH),
    getRefreshIntervalMinutes: (env: unknown): number =>
      EnvParser.positiveInt(env, 'CREDENTIAL_REFRESH_INTERVAL_MINUTES', DEFAULT_CREDENTIAL_REFRESH_INTERVAL_MINUTES),
  };

  public static readonly token = {
    getMaxPerUser: (env: unknown): number => EnvParser.positiveInt(env, 'MAX_TOKENS_PER_USER', DEFAULT_MAX_TOKENS_PER_USER),
    getMaxExpiryDays: (env: unknown): number => EnvParser.positiveInt(env, 'MAX_TOKEN_EXPIRY_DAYS', DEFAULT_MAX_TOKEN_EXPIRY_DAYS),
  };

  public static readonly audit = {
    getRetentionDays: (env: unknown): number => EnvParser.positiveInt(env, 'AUDIT_LOG_RETENTION_DAYS', DEFAULT_AUDIT_LOG_RETENTION_DAYS),
  };

  public static readonly processing = {
    getTaskRunRetentionDays: (env: unknown): number =>
      EnvParser.positiveInt(env, 'BACKGROUND_TASK_RUN_RETENTION_DAYS', DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS),
    getPruneBatchSize: (env: unknown): number => EnvParser.positiveInt(env, 'PRUNE_BATCH_SIZE', DEFAULT_PRUNE_BATCH_SIZE),
  };

  public static readonly costs = {
    getCollectionIntervalHours: (env: unknown): number =>
      EnvParser.positiveInt(env, 'COST_COLLECTION_INTERVAL_HOURS', DEFAULT_COST_COLLECTION_INTERVAL_HOURS),
    getLookbackDays: (env: unknown): number => EnvParser.positiveInt(env, 'COST_LOOKBACK_DAYS', DEFAULT_COST_LOOKBACK_DAYS),
  };

  public static readonly resource = {
    getCollectionIntervalHours: (env: unknown): number =>
      EnvParser.positiveInt(env, 'RESOURCE_COLLECTION_INTERVAL_HOURS', DEFAULT_RESOURCE_COLLECTION_INTERVAL_HOURS),
  };

  public static readonly auth = {
    getTeamDomain: (env: unknown): string | undefined => (env as Record<string, string | undefined>)['TEAM_DOMAIN'],
    getPolicyAud: (env: unknown): string | undefined => (env as Record<string, string | undefined>)['POLICY_AUD'],
    getDevAuthEmail: (env: unknown): string | undefined => (env as Record<string, string | undefined>)['DEV_AUTH_EMAIL'],
    isDemoMode: (env: unknown): boolean => EnvParser.boolean(env, 'DEMO_MODE', DEFAULT_DEMO_MODE),
  };

  public static readonly internal = {
    getRequestTimeWindowMs: (env: unknown): number =>
      EnvParser.positiveInt(
        env,
        'INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS',
        DEFAULT_INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS,
      ),
  };

  public static readonly spa = {
    isServeFromWorker: (env: unknown): boolean => EnvParser.boolean(env, 'SERVE_SPA_FROM_WORKER', DEFAULT_SERVE_SPA_FROM_WORKER),
  };

  // ─── Flat API (delegates to namespace groups) ────────────

  public static getTrustChainLimit(env: unknown): number {
    return this.credential.getTrustChainLimit(env);
  }
  public static getMaxTokensPerUser(env: unknown): number {
    return this.token.getMaxPerUser(env);
  }
  public static getMaxTokenExpiryDays(env: unknown): number {
    return this.token.getMaxExpiryDays(env);
  }
  public static getAuditLogRetentionDays(env: unknown): number {
    return this.audit.getRetentionDays(env);
  }
  public static getBackgroundTaskRunRetentionDays(env: unknown): number {
    return this.processing.getTaskRunRetentionDays(env);
  }
  public static isDemoMode(env: unknown): boolean {
    return this.auth.isDemoMode(env);
  }
  public static isServeSpaFromWorker(env: unknown): boolean {
    return this.spa.isServeFromWorker(env);
  }
  public static getInternalRequestTimeWindowMs(env: unknown): number {
    return this.internal.getRequestTimeWindowMs(env);
  }
}

export { ConfigurationManager };
