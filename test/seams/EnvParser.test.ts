import { describe, it, expect } from 'vitest';
import { EnvParser } from '@aws-access-bridge/backend-runtime/config';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';

describe('EnvParser', () => {
  it('parses positive ints with fallbacks', () => {
    expect(EnvParser.positiveInt({ N: '5' }, 'N', '3')).toBe(5);
    expect(EnvParser.positiveInt({ N: '0' }, 'N', '3')).toBe(3);
    expect(EnvParser.positiveInt({ N: '-2' }, 'N', '3')).toBe(3);
    expect(EnvParser.positiveInt({ N: 'abc' }, 'N', '3')).toBe(3);
    expect(EnvParser.positiveInt({}, 'N', '3')).toBe(3);
    expect(EnvParser.positiveInt({ N: '2.5' }, 'N', '3')).toBe(3);
  });

  it('parses non-negative ints including zero', () => {
    expect(EnvParser.nonNegativeInt({ N: '0' }, 'N', '7')).toBe(0);
    expect(EnvParser.nonNegativeInt({ N: '-1' }, 'N', '7')).toBe(7);
    expect(EnvParser.nonNegativeInt({}, 'N', '7')).toBe(7);
  });

  it('reads strings and booleans', () => {
    expect(EnvParser.string({ S: 'x' }, 'S', 'd')).toBe('x');
    expect(EnvParser.string({}, 'S', 'd')).toBe('d');
    expect(EnvParser.boolean({ B: 'true' }, 'B', 'false')).toBe(true);
    expect(EnvParser.boolean({ B: 'yes' }, 'B', 'false')).toBe(false);
    expect(EnvParser.boolean({}, 'B', 'true')).toBe(true);
  });
});

describe('ConfigurationManager namespaces', () => {
  it('resolves every namespace with env overrides and defaults', () => {
    const env = {
      PRINCIPAL_TRUST_CHAIN_LIMIT: '4',
      MAX_TOKENS_PER_USER: '9',
      MAX_TOKEN_EXPIRY_DAYS: '11',
      AUDIT_LOG_RETENTION_DAYS: '12',
      BACKGROUND_TASK_RUN_RETENTION_DAYS: '13',
      PRUNE_BATCH_SIZE: '14',
      COST_COLLECTION_INTERVAL_HOURS: '15',
      COST_LOOKBACK_DAYS: '16',
      RESOURCE_COLLECTION_INTERVAL_HOURS: '17',
      TEAM_DOMAIN: 'https://x',
      POLICY_AUD: 'aud',
      DEV_AUTH_EMAIL: 'dev@example.com',
      DEMO_MODE: 'true',
      INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS: '18',
      SERVE_SPA_FROM_WORKER: 'true',
    };
    expect(ConfigurationManager.credential.getTrustChainLimit(env)).toBe(4);
    expect(ConfigurationManager.token.getMaxPerUser(env)).toBe(9);
    expect(ConfigurationManager.token.getMaxExpiryDays(env)).toBe(11);
    expect(ConfigurationManager.audit.getRetentionDays(env)).toBe(12);
    expect(ConfigurationManager.processing.getTaskRunRetentionDays(env)).toBe(13);
    expect(ConfigurationManager.processing.getPruneBatchSize(env)).toBe(14);
    expect(ConfigurationManager.costs.getCollectionIntervalHours(env)).toBe(15);
    expect(ConfigurationManager.costs.getLookbackDays(env)).toBe(16);
    expect(ConfigurationManager.resource.getCollectionIntervalHours(env)).toBe(17);
    expect(ConfigurationManager.auth.getTeamDomain(env)).toBe('https://x');
    expect(ConfigurationManager.auth.getPolicyAud(env)).toBe('aud');
    expect(ConfigurationManager.auth.getDevAuthEmail(env)).toBe('dev@example.com');
    expect(ConfigurationManager.auth.isDemoMode(env)).toBe(true);
    expect(ConfigurationManager.internal.getRequestTimeWindowMs(env)).toBe(18);
    expect(ConfigurationManager.spa.isServeFromWorker(env)).toBe(true);
  });

  it('falls back to defaults for empty env', () => {
    expect(ConfigurationManager.credential.getTrustChainLimit({})).toBeGreaterThan(0);
    expect(ConfigurationManager.auth.isDemoMode({})).toBe(false);
    expect(ConfigurationManager.auth.getTeamDomain({})).toBeUndefined();
    expect(ConfigurationManager.spa.isServeFromWorker({})).toBe(false);
  });
});
