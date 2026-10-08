import { describe, expect, it, vi, beforeEach } from 'vitest';

const createRemoteJWKSet = vi.hoisted(() => vi.fn(() => async () => ({})));
const jwtVerify = vi.hoisted(() => vi.fn().mockRejectedValue(new Error('bad token')));

vi.mock('jose', () => ({
  createRemoteJWKSet,
  jwtVerify,
}));

import { AccessAuthService, resetJwksCacheForTests } from '@aws-access-bridge/backend-services/auth/AccessAuthService';

const withToken = (): Request => new Request('https://app.example.com/x', { headers: { 'cf-access-jwt-assertion': 'tok' } });

describe('JWKS caching', () => {
  beforeEach(() => {
    createRemoteJWKSet.mockClear();
    jwtVerify.mockClear();
    resetJwksCacheForTests();
  });

  it('creates one remote JWKS fetcher per team domain URL across requests', async () => {
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.example.com', 'aud')).rejects.toThrow(
      /JWT verification failed/,
    );
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.example.com', 'aud')).rejects.toThrow(
      /JWT verification failed/,
    );
    expect(createRemoteJWKSet).toHaveBeenCalledTimes(1);

    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://other.example.com', 'aud')).rejects.toThrow(
      /JWT verification failed/,
    );
    expect(createRemoteJWKSet).toHaveBeenCalledTimes(2);
  });

  it('the reset clears the cache so a new fetcher is built', async () => {
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.example.com', 'aud')).rejects.toThrow(
      /JWT verification failed/,
    );
    resetJwksCacheForTests();
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.example.com', 'aud')).rejects.toThrow(
      /JWT verification failed/,
    );
    expect(createRemoteJWKSet).toHaveBeenCalledTimes(2);
  });
});
