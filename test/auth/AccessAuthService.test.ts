import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccessAuthService } from '@aws-access-bridge/backend-services/auth/AccessAuthService';
import { InternalServerError } from '@aws-access-bridge/backend-errors';

function env(overrides: Record<string, string> = {}) {
  return {
    TEAM_DOMAIN: 'https://x.cloudflareaccess.com',
    POLICY_AUD: 'aud',
    ...overrides,
  } as never;
}

const REQUEST: Request = new Request('https://example.com/user/me');

describe('AccessAuthService DEV_AUTH_EMAIL guard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `DEV_AUTH_EMAIL` is read *before* JWT verification, from an ordinary
   * Wrangler var. With no environment guard, a `.dev.vars` promoted by mistake
   * authenticated every caller as that address — including as super-admin
   * (`IAdminActivityAPIRoute`) and for `/api/aws/assume-role`.
   */
  it('refuses the bypass in production instead of authenticating', async () => {
    const service = new AccessAuthService(env({ DEV_AUTH_EMAIL: 'dev@example.com', ENVIRONMENT: 'production' }));
    await expect(service.getAuthenticatedUserEmail(REQUEST)).rejects.toBeInstanceOf(InternalServerError);
  });

  it('names the offending variable so the fix is obvious', async () => {
    const service = new AccessAuthService(env({ DEV_AUTH_EMAIL: 'dev@example.com', ENVIRONMENT: 'production' }));
    await expect(service.getAuthenticatedUserEmail(REQUEST)).rejects.toThrow(/DEV_AUTH_EMAIL/);
  });

  it.each(['development', 'staging', 'local', ''])('still permits the bypass when ENVIRONMENT is %j', async (environment) => {
    const service = new AccessAuthService(env({ DEV_AUTH_EMAIL: 'dev@example.com', ENVIRONMENT: environment }));
    await expect(service.getAuthenticatedUserEmail(REQUEST)).resolves.toBe('dev@example.com');
  });

  it('permits the bypass when ENVIRONMENT is unset', async () => {
    // The integration suite sets DEV_AUTH_EMAIL in vars with no ENVIRONMENT,
    // which is exactly the mistake; the guard is opt-in so a fresh clone and the
    // test harness keep working.
    const service = new AccessAuthService(env({ DEV_AUTH_EMAIL: 'dev@example.com' }));
    await expect(service.getAuthenticatedUserEmail(REQUEST)).resolves.toBe('dev@example.com');
  });

  it('warns on every bypass so an unexpected one is visible in the logs', async () => {
    const service = new AccessAuthService(env({ DEV_AUTH_EMAIL: 'dev@example.com' }));
    await service.getAuthenticatedUserEmail(REQUEST);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DEV_AUTH_EMAIL'));
  });

  it('is not reached in demo mode, which takes precedence', async () => {
    // DEMO_MODE is an intentional, documented switch; the production guard is not
    // meant to break it.
    const service = new AccessAuthService(env({ DEMO_MODE: 'true', DEV_AUTH_EMAIL: 'dev@example.com', ENVIRONMENT: 'production' }));
    await expect(service.getAuthenticatedUserEmail(REQUEST)).resolves.toBe('demo@example.com');
  });

  it('falls through to JWT verification when DEV_AUTH_EMAIL is unset', async () => {
    const service = new AccessAuthService(env());
    await expect(service.getAuthenticatedUserEmail(REQUEST)).rejects.toThrow(/No Cloudflare Access JWT token/);
  });
});