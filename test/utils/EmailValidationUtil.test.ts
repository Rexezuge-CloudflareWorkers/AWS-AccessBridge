import { describe, it, expect } from 'vitest';
import { AccessAuthService } from '@aws-access-bridge/backend-services/auth';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { INTERNAL_USER_EMAIL_HEADER, SELF_WORKER_BASE_HOSTNAME } from '@aws-access-bridge/shared/constants';

describe('AccessAuthService', () => {
  describe('verifyAccessJwt', () => {
    it('rejects internal self-worker requests (strict split: internal calls never use Access auth)', async () => {
      const request = new Request(`https://${SELF_WORKER_BASE_HOSTNAME}/user/test`, {
        headers: { [INTERNAL_USER_EMAIL_HEADER]: 'internal@example.com' },
      });
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(UnauthorizedError);
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });

    it('does not authenticate using the Cloudflare Access email header', async () => {
      const request = new Request('https://worker.example.com/user/test', {
        headers: { 'Cf-Access-Authenticated-User-Email': 'user@example.com' },
      });
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(UnauthorizedError);
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });

    it('throws UnauthorizedError when no JWT token is present', async () => {
      const request = new Request('https://worker.example.com/user/test');
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(UnauthorizedError);
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });

    it('throws UnauthorizedError when JWT token present but missing config', async () => {
      const request = new Request('https://worker.example.com/user/test', {
        headers: { 'cf-access-jwt-assertion': 'some-jwt-token' },
      });
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow(UnauthorizedError);
      await expect(AccessAuthService.verifyAccessJwt(request)).rejects.toThrow('Missing required JWT verification configuration.');
    });

    it('throws UnauthorizedError when JWT token present but teamDomain missing', async () => {
      const request = new Request('https://worker.example.com/user/test', {
        headers: { 'cf-access-jwt-assertion': 'some-jwt-token' },
      });
      await expect(AccessAuthService.verifyAccessJwt(request, undefined, 'some-aud')).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when multiple JWT audiences are configured', async () => {
      const request = new Request('https://worker.example.com/user/test', {
        headers: { 'cf-access-jwt-assertion': 'some-jwt-token' },
      });
      await expect(AccessAuthService.verifyAccessJwt(request, 'https://team.example.com', 'aud-one,aud-two')).rejects.toThrow(
        'Multiple JWT audiences are not supported. Configure a single POLICY_AUD value.',
      );
    });
  });

  describe('getAuthenticatedUserEmail', () => {
    it('uses the demo user when demo mode is enabled', async () => {
      const service = new AccessAuthService({ DEMO_MODE: 'true' });
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'))).resolves.toBe(
        'demo@example.com',
      );
    });

    it('uses the dev bypass email when configured', async () => {
      const service = new AccessAuthService({ DEV_AUTH_EMAIL: 'dev@example.com' });
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'))).resolves.toBe('dev@example.com');
    });

    it('uses the platform-verified identity when JWT vars are unset (Worker-level Access)', async () => {
      const service = new AccessAuthService({});
      const accessCtx = { access: { getIdentity: async () => ({ email: 'platform@example.com' }) } };
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'), accessCtx)).resolves.toBe(
        'platform@example.com',
      );
    });

    it('rejects when JWT vars are unset and the platform identity has no email', async () => {
      const service = new AccessAuthService({});
      const accessCtx = { access: { getIdentity: async () => null } };
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'), accessCtx)).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });

    it('rejects when JWT vars are unset and no platform identity is available', async () => {
      const service = new AccessAuthService({});
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'))).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });

    it('prefers JWT verification over the platform identity when JWT vars are set', async () => {
      const service = new AccessAuthService({ TEAM_DOMAIN: 'https://team.example.com', POLICY_AUD: 'aud' });
      const accessCtx = { access: { getIdentity: async () => ({ email: 'platform@example.com' }) } };
      await expect(service.getAuthenticatedUserEmail(new Request('https://worker.example.com/user/test'), accessCtx)).rejects.toThrow(
        'No Cloudflare Access JWT token provided in request headers.',
      );
    });
  });
});
