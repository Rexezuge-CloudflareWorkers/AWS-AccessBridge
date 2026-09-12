import { describe, it, expect } from 'vitest';
import {
  D1_SESSION_CONSTRAINT_FIRST_PRIMARY,
  D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED,
} from '@aws-access-bridge/backend-data/constants/d1';
import {
  KV_NAMESPACE_DELIMITER,
  KV_NAMESPACE_CREDENTIAL_CACHE,
  KV_MINIMUM_TIVE_TO_LIVE_SECONDS,
  KV_VALUE_TYPE_JSON,
} from '@aws-access-bridge/backend-data/constants/kv';
import {
  ASSUME_ROLE_UTIL_ERROR_STS_CALL,
  ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE,
  HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS,
  HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW,
  HMAC_HANDLER_ERROR_SIGNATURE_INVALID,
} from '@aws-access-bridge/backend-errors/constants';
import {
  DEFAULT_MAX_TOKENS_PER_USER,
  DEFAULT_MAX_TOKEN_EXPIRY_DAYS,
  DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT,
  CREDENTIAL_EXPIRY_BUFFER_MINUTES,
  NUMBER_OF_CREDENTIALS_TO_REFRESH,
  CREDENTIAL_REFRESH_INTERVAL_MINUTES,
  INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS,
} from '@aws-access-bridge/backend-runtime/config';
import {
  INTERNAL_HEADER_PREFIX,
  INTERNAL_USER_EMAIL_HEADER,
  INTERNAL_BASE_URL_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  CONTENT_TYPE,
  APPLICATION_JSON,
  SELF_WORKER_BASE_HOSTNAME,
  SELF_WORKER_BASE_URL,
  ROLE_SESSION_NAME_PREFIX,
  INTERMEDIATE_ROLE_SESSION_NAME,
  CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME,
} from '@aws-access-bridge/shared/constants';

describe('Constants', () => {
  describe('ConfigurationDefaults', () => {
    it('has correct default max tokens per user', () => {
      expect(DEFAULT_MAX_TOKENS_PER_USER).toBe('5');
    });

    it('has correct default max token expiry days', () => {
      expect(DEFAULT_MAX_TOKEN_EXPIRY_DAYS).toBe('90');
    });

    it('has correct default principal trust chain limit', () => {
      expect(DEFAULT_PRINCIPAL_TRUST_CHAIN_LIMIT).toBe('3');
    });
  });

  describe('Configurations', () => {
    it('has credential expiry buffer of 5 minutes', () => {
      expect(CREDENTIAL_EXPIRY_BUFFER_MINUTES).toBe(5);
    });

    it('has 10 credentials to refresh per batch', () => {
      expect(NUMBER_OF_CREDENTIALS_TO_REFRESH).toBe(10);
    });

    it('has 45 minute refresh interval', () => {
      expect(CREDENTIAL_REFRESH_INTERVAL_MINUTES).toBe(45);
    });

    it('has 1 second internal request time window', () => {
      expect(INTERNAL_REQUEST_VALID_TIME_WINDOW_MILLISECONDS).toBe(1000);
    });
  });

  describe('Headers', () => {
    it('has correct internal header prefix', () => {
      expect(INTERNAL_HEADER_PREFIX).toBe('x-internal-');
    });

    it('has correct internal user email header', () => {
      expect(INTERNAL_USER_EMAIL_HEADER).toBe('x-internal-user-email');
    });

    it('has correct internal base URL header', () => {
      expect(INTERNAL_BASE_URL_HEADER).toBe('x-internal-base-url');
    });

    it('has correct internal timestamp header', () => {
      expect(INTERNAL_TIMESTAMP_HEADER).toBe('x-internal-timestamp');
    });

    it('has correct internal signature header', () => {
      expect(INTERNAL_SIGNATURE_HEADER).toBe('x-internal-signature');
    });

    it('all internal headers start with the prefix', () => {
      expect(INTERNAL_USER_EMAIL_HEADER.startsWith(INTERNAL_HEADER_PREFIX)).toBe(true);
      expect(INTERNAL_BASE_URL_HEADER.startsWith(INTERNAL_HEADER_PREFIX)).toBe(true);
      expect(INTERNAL_TIMESTAMP_HEADER.startsWith(INTERNAL_HEADER_PREFIX)).toBe(true);
      expect(INTERNAL_SIGNATURE_HEADER.startsWith(INTERNAL_HEADER_PREFIX)).toBe(true);
    });

    it('has correct content type and JSON values', () => {
      expect(CONTENT_TYPE).toBe('Content-Type');
      expect(APPLICATION_JSON).toBe('application/json');
    });
  });

  describe('Hostnames', () => {
    it('has correct self-worker hostname', () => {
      expect(SELF_WORKER_BASE_HOSTNAME).toBe('self.invalid');
    });

    it('has correct self-worker base URL', () => {
      expect(SELF_WORKER_BASE_URL).toBe('https://self.invalid');
    });

    it('base URL includes the hostname', () => {
      expect(SELF_WORKER_BASE_URL).toContain(SELF_WORKER_BASE_HOSTNAME);
    });
  });

  describe('RoleSessionNames', () => {
    it('has correct prefix', () => {
      expect(ROLE_SESSION_NAME_PREFIX).toBe('AccessBridge-');
    });

    it('intermediate session name starts with prefix', () => {
      expect(INTERMEDIATE_ROLE_SESSION_NAME).toBe('AccessBridge-Intermediate');
      expect(INTERMEDIATE_ROLE_SESSION_NAME.startsWith(ROLE_SESSION_NAME_PREFIX)).toBe(true);
    });

    it('cache refresh session name starts with prefix', () => {
      expect(CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME).toBe('AccessBridge-CredentialCacheRefresh');
      expect(CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME.startsWith(ROLE_SESSION_NAME_PREFIX)).toBe(true);
    });
  });

  describe('D1 SessionConstraints', () => {
    it('has correct first-primary constraint', () => {
      expect(D1_SESSION_CONSTRAINT_FIRST_PRIMARY).toBe('first-primary');
    });

    it('has correct first-unconstrained constraint', () => {
      expect(D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED).toBe('first-unconstrained');
    });
  });

  describe('KV Constants', () => {
    it('has correct namespace delimiter', () => {
      expect(KV_NAMESPACE_DELIMITER).toBe('::');
    });

    it('has correct credential cache namespace', () => {
      expect(KV_NAMESPACE_CREDENTIAL_CACHE).toBe('CC');
    });

    it('has minimum TTL of 60 seconds', () => {
      expect(KV_MINIMUM_TIVE_TO_LIVE_SECONDS).toBe(60);
    });

    it('has JSON value type', () => {
      expect(KV_VALUE_TYPE_JSON).toBe('json');
    });
  });

  describe('Error Messages', () => {
    it('has STS call error message', () => {
      expect(ASSUME_ROLE_UTIL_ERROR_STS_CALL).toContain('permissions issue');
    });

    it('has STS response parse error message', () => {
      expect(ASSUME_ROLE_UTIL_ERROR_STS_RESPONSE_PARSE).toContain('parse temporary credentials');
    });

    it('has HMAC missing headers error message', () => {
      expect(HMAC_HANDLER_ERROR_MISSING_AUTHENTICATION_HEADERS).toContain('Missing internal authentication headers');
    });

    it('has HMAC time window error message', () => {
      expect(HMAC_HANDLER_ERROR_REQUEST_OUTSIDE_TIME_WINDOW).toContain('Request timestamp outside valid time window');
    });

    it('has HMAC invalid signature error message', () => {
      expect(HMAC_HANDLER_ERROR_SIGNATURE_INVALID).toContain('signature invalid');
    });
  });
});
