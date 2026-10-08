import { describe, it, expect } from 'vitest';
import { TokenHashUtil } from '@aws-access-bridge/shared/utils/TokenHashUtil';
import { FederationService } from '@aws-access-bridge/backend-services/aws/federate/FederationService';
import type { AssumeRoleService } from '@aws-access-bridge/backend-services/aws/assume-role/AssumeRoleService';
import type { ConsoleService } from '@aws-access-bridge/backend-services/aws/console/ConsoleService';
import { BadGatewayError, NotFoundError, RateLimitedError } from '@aws-access-bridge/backend-errors';

describe('TokenHashUtil', () => {
  it('is a stable 64-hex SHA-256 digest', async () => {
    const digest: string = await TokenHashUtil.sha256Hex('pat-value');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(TokenHashUtil.sha256Hex('pat-value')).resolves.toBe(digest);
    // The digest is not the input in any recoverable form: a stored row cannot
    // be replayed as a bearer credential.
    expect(digest).not.toContain('pat-value');
    expect(await TokenHashUtil.sha256Hex('other')).not.toBe(digest);
  });

  it('handles the empty string rather than throwing', async () => {
    expect(await TokenHashUtil.sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * The federation facade is what replaced two HMAC-signed loopback fetches. These
 * tests pin the composition order and the argument mapping — the parts a route
 * rewrite can silently reorder.
 */
describe('FederationService', () => {
  function services(overrides: { token?: () => Promise<string> } = {}): {
    assumeRole: AssumeRoleService;
    consoleService: ConsoleService;
    service: FederationService;
  } {
    const assumeRole = {
      assumeRoleForUser: (userEmail: string, principalArn: string) =>
        Promise.resolve({
          accessKeyId: `AK-${userEmail}-${principalArn}`,
          secretAccessKey: 'S',
          sessionToken: 'T',
          expiration: '2026-01-01T00:00:00Z',
        }),
    } as unknown as AssumeRoleService;
    const consoleService = {
      getSigninToken: overrides.token ?? ((): Promise<string> => Promise.resolve('tok')),
      buildIssuerUrl: (base: string, account?: string, role?: string): string => `${base}|${account}|${role}`,
      buildDestination: (path?: string, region?: string): string => `dest:${path ?? ''}:${region ?? ''}`,
      getLoginUrl: (token: string, issuer: string, destination: string): string =>
        `login?token=${token}&issuer=${issuer}&dest=${destination}`,
    } as unknown as ConsoleService;
    return { assumeRole, consoleService, service: new FederationService(assumeRole, consoleService) };
  }

  it('assumes, exchanges for a signin token, and builds the login URL in order', async () => {
    const { service } = services();
    const url: string = await service.generateConsoleUrlForUser(
      'u@e.com',
      'arn:aws:iam::123456789012:role/Dev',
      'https://app',
      '123456789012',
      'Dev',
      'ec2/home',
      'eu-west-1',
    );
    expect(url).toBe('login?token=tok&issuer=https://app|123456789012|Dev&dest=dest:ec2/home:eu-west-1');
  });

  it('omits the destination parts the caller did not pass', async () => {
    const { service } = services();
    const url: string = await service.generateConsoleUrlForUser('u@e.com', 'arn', 'https://app', undefined, undefined);
    expect(url).toContain('dest=dest::');
    expect(url).toContain('issuer=https://app|undefined|undefined');
  });

  it('propagates a denied assume so the route can answer 403, without asking AWS for a token', async () => {
    let tokenCalls = 0;
    const { service, consoleService } = services({
      token: (): Promise<string> => {
        tokenCalls += 1;
        return Promise.resolve('tok');
      },
    });
    const failing = new FederationService(
      {
        assumeRoleForUser: (): Promise<never> => Promise.reject(new NotFoundError('no credentials')),
      } as unknown as AssumeRoleService,
      consoleService,
    );
    await expect(failing.generateConsoleUrlForUser('u@e.com', 'arn', 'https://app', '123456789012', 'Dev')).rejects.toThrow(NotFoundError);
    expect(tokenCalls).toBe(0);
    expect(service).toBeTruthy();
  });
});

describe('the errors the hardening added', () => {
  it('map to the statuses the SPA relies on', () => {
    // 401 means "your session ended" and redirects to Zero Trust, so a missing
    // grant or a failed upstream must never answer with it.
    expect(new NotFoundError('x').getErrorCode()).toBe(404);
    expect(new BadGatewayError('x').getErrorCode()).toBe(502);
    expect(new RateLimitedError('x').getErrorCode()).toBe(429);
    expect(new RateLimitedError().getErrorType()).toBe('RateLimited');
    expect(new RateLimitedError('slow down').getErrorMessage()).toBe('slow down');
  });
});
