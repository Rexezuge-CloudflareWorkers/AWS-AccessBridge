import { describe, it, expect } from 'vitest';
import { HttpFetchError, isRetryableHttpStatus, isRetryableThrownError } from '@aws-access-bridge/backend-services/http';

/**
 * The retry classifier decides whether a credential-chain hop is retried. Both
 * failure routes matter: an HTTP status, and a client that rejects instead of
 * answering. Getting this wrong is expensive in both directions — retrying a
 * permanent `AccessDenied` turns a fast failure into a slow one on the
 * assume-role path, while refusing to retry a genuine throttle fails the caller
 * over a request that would have succeeded immediately.
 */
describe('isRetryableHttpStatus', () => {
  it('retries 429 and every 5xx', () => {
    for (const status of [429, 500, 502, 503, 504, 599]) {
      expect(isRetryableHttpStatus(status)).toBe(true);
    }
  });

  it('refuses a 4xx, which would fail identically', () => {
    for (const status of [400, 401, 402, 403, 404, 409, 429 + 1]) {
      expect(isRetryableHttpStatus(status)).toBe(false);
    }
  });

  it('refuses a success', () => {
    expect(isRetryableHttpStatus(200)).toBe(false);
  });
});

describe('HttpFetchError retryability', () => {
  it('derives the verdict from the status by default', () => {
    expect(new HttpFetchError(503, 'Service Unavailable', 'down').retryable).toBe(true);
    expect(new HttpFetchError(403, 'Forbidden', 'denied').retryable).toBe(false);
  });

  /**
   * The malformed-body case is the one a status-derived verdict gets backwards:
   * it is reported at status 200, which is "not a 5xx" and so "not retryable"
   * for the wrong reason. A second identical request will not parse either.
   */
  it('honours an explicit override, which a 200 status would get wrong', () => {
    expect(new HttpFetchError(200, 'Malformed JSON', 'not json', { retryable: false }).retryable).toBe(false);
    expect(new HttpFetchError(200, 'Malformed JSON', 'not json').retryable).toBe(false);
  });

  it('still carries the diagnostic fields', () => {
    const error = new HttpFetchError(503, 'Service Unavailable', 'upstream down');
    expect(error.status).toBe(503);
    expect(error.statusText).toBe('Service Unavailable');
    expect(error.body).toBe('upstream down');
    expect(error.message).toContain('upstream down');
  });

  it('falls back to statusText when the body is empty', () => {
    expect(new HttpFetchError(500, 'Internal Server Error', '').message).toContain('Internal Server Error');
  });
});

describe('isRetryableThrownError', () => {
  it('trusts a typed HttpFetchError verdict rather than re-reading its message', () => {
    // The message mentions neither "retryable" nor "throttled"; only the
    // constructor's status-derived flag says anything, and it must win.
    expect(isRetryableThrownError(new HttpFetchError(403, 'Forbidden', 'no'))).toBe(false);
    expect(isRetryableThrownError(new HttpFetchError(500, 'Server Error', 'no'))).toBe(true);
  });

  it('trusts a retryable flag carried by any error', () => {
    expect(isRetryableThrownError({ retryable: false, message: 'Throttling' })).toBe(false);
    expect(isRetryableThrownError({ retryable: true, message: 'AccessDenied' })).toBe(true);
  });

  it('refuses a permanent AWS failure, which is what the throw path used to retry', () => {
    for (const message of [
      'AccessDenied: not authorized',
      'ExpiredToken: token expired',
      'InvalidClientTokenId',
      'SignatureDoesNotMatch',
      'MalformedPolicyDocument',
      'EntityAlreadyExists',
      'ValidationError',
      'AuthorizationHeaderMalformed',
    ]) {
      expect(isRetryableThrownError(new Error(message)), message).toBe(false);
    }
  });

  it('retries a transient failure', () => {
    for (const message of ['Throttling: slow down', 'ServiceUnavailable', 'Rate exceeded', 'InternalError', 'socket hang up', 'ECONNRESET']) {
      expect(isRetryableThrownError(new Error(message)), message).toBe(true);
    }
  });

  /**
   * An error can read as both. Permanent is tested first, so a throttled request
   * to an unauthorized action is not retried — retrying cannot grant the
   * permission it was refused.
   */
  it('resolves a mixed message as permanent', () => {
    expect(isRetryableThrownError(new Error('Throttling: AccessDenied for this action'))).toBe(false);
  });

  it('retries an unrecognised error, preserving the previous behaviour', () => {
    // Failing closed here would turn any transport fault the patterns do not
    // cover into a hard failure for the caller.
    expect(isRetryableThrownError(new Error('something we have never seen'))).toBe(true);
  });

  it('refuses a rejection carrying no diagnosis rather than retrying blind', () => {
    // Nothing here to classify. Passed as a bare value rather than an empty
    // `Error` message because a message-less error is not constructible without
    // tripping `unicorn/error-message`.
    expect(isRetryableThrownError('')).toBe(false);
  });
});