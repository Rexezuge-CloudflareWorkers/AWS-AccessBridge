import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccessAuthService } from '@aws-access-bridge/backend-services/auth/AccessAuthService';
import { InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { DEMO_USER_EMAIL } from '@aws-access-bridge/shared/constants';

/**
 * `AccessAuthService` decides who every `/user/*` request is, so this suite is
 * about the *order* of the branches as much as each one:
 *
 *   DEMO_MODE → DEV_AUTH_EMAIL → JWT (explicit config) → platform identity →
 *   JWT (fallback)
 *
 * The two branches that matter most are the ones that fail closed:
 *
 * - `DEV_AUTH_EMAIL` in production throws rather than authenticating. It is read
 *   from an ordinary var with no platform guard, so a `.dev.vars` promoted by
 *   mistake would otherwise authenticate every caller as that address,
 *   super-admin included, and for `/api/aws/assume-role`.
 * - a spoofable `Cf-Access-Authenticated-User-Email` header is never consulted;
 *   only the signed `cf-access-jwt-assertion` or the platform identity are.
 */
describe('AccessAuthService.getAuthenticatedUserEmail', () => {
  const request = (): Request => new Request('https://app.example.com/user/me');

  function service(env: Record<string, unknown>): AccessAuthService {
    return new AccessAuthService(env as never);
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the demo identity when DEMO_MODE is set', async () => {
    await expect(service({ DEMO_MODE: 'true', DEV_AUTH_EMAIL: 'dev@example.com' }).getAuthenticatedUserEmail(request())).resolves.toBe(
      DEMO_USER_EMAIL,
    );
  });

  it('honours DEV_AUTH_EMAIL outside production', async () => {
    await expect(service({ DEV_AUTH_EMAIL: 'dev@example.com' }).getAuthenticatedUserEmail(request())).resolves.toBe('dev@example.com');
  });

  it('FAILS CLOSED on DEV_AUTH_EMAIL in production', async () => {
    // The whole point: a stray var must not become an authentication bypass.
    await expect(
      service({ DEV_AUTH_EMAIL: 'admin@example.com', ENVIRONMENT: 'production' }).getAuthenticatedUserEmail(request()),
    ).rejects.toThrow(InternalServerError);
  });

  it('names the remediation in the production error', async () => {
    await expect(service({ DEV_AUTH_EMAIL: 'a@e.com', ENVIRONMENT: 'production' }).getAuthenticatedUserEmail(request())).rejects.toThrow(
      /Remove it and redeploy/,
    );
  });

  it.each(['development', 'staging', 'prod', '', 'PRODUCTION'])('treats ENVIRONMENT=%p as not production', async (environment) => {
    // Only the exact literal arms the guard, so a misconfigured value must fail
    // *open* here rather than lock every caller out.
    await expect(
      service({ DEV_AUTH_EMAIL: 'dev@example.com', ENVIRONMENT: environment }).getAuthenticatedUserEmail(request()),
    ).resolves.toBe('dev@example.com');
  });

  it('uses the platform-verified identity when no JWT vars are set', async () => {
    // Worker-level Access: the platform has already authenticated the request.
    const accessCtx = { access: { getIdentity: vi.fn().mockResolvedValue({ email: 'worker@example.com' }) } };

    await expect(service({}).getAuthenticatedUserEmail(request(), accessCtx)).resolves.toBe('worker@example.com');
  });

  it('never trusts the spoofable Cf-Access-Authenticated-User-Email header', async () => {
    // A caller can set this header freely. With no platform identity available it
    // must fall through to JWT verification, not accept the header.
    const spoofed = new Request('https://app.example.com/user/me', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' },
    });

    await expect(
      service({}).getAuthenticatedUserEmail(spoofed, { access: { getIdentity: vi.fn().mockResolvedValue(null) } }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('prefers explicit JWT config over the platform identity when both are present', async () => {
    const accessCtx = { access: { getIdentity: vi.fn().mockResolvedValue({ email: 'worker@example.com' }) } };
    const svc = service({ TEAM_DOMAIN: 'https://team.cloudflareaccess.com', POLICY_AUD: 'aud' });
    const spy = vi.spyOn(AccessAuthService, 'verifyAccessJwt');

    await expect(svc.getAuthenticatedUserEmail(request(), accessCtx)).rejects.toBeDefined();
    // Explicit vars win, so the platform fallback is not consulted at all.
    expect(accessCtx.access.getIdentity).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('survives a platform identity read that rejects', async () => {
    // A runtime without Worker-level Access has no `access` at all; one where the
    // read throws must degrade to the JWT path rather than 500.
    const accessCtx = { access: { getIdentity: vi.fn().mockRejectedValue(new Error('not supported')) } };

    await expect(service({}).getAuthenticatedUserEmail(request(), accessCtx)).rejects.toThrow(UnauthorizedError);
  });

  it('tolerates a missing access context entirely', async () => {
    await expect(service({}).getAuthenticatedUserEmail(request())).rejects.toThrow(UnauthorizedError);
    await expect(service({}).getAuthenticatedUserEmail(request(), {})).rejects.toThrow(UnauthorizedError);
  });
});

describe('AccessAuthService.verifyAccessJwt configuration guards', () => {
  const withToken = (): Request => new Request('https://app.example.com/user/me', { headers: { 'cf-access-jwt-assertion': 'token' } });

  it('rejects a request with no assertion header', async () => {
    await expect(AccessAuthService.verifyAccessJwt(new Request('https://x/'), 'https://t', 'aud')).rejects.toThrow(
      /No Cloudflare Access JWT token/,
    );
  });

  it('rejects when the token is present but no verification config is', async () => {
    // Order matters: the header check runs first, so a caller cannot probe for
    // configuration by sending a token.
    await expect(AccessAuthService.verifyAccessJwt(withToken())).rejects.toThrow(/Missing required JWT verification configuration/);
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://t')).rejects.toThrow(
      /Missing required JWT verification configuration/,
    );
    await expect(AccessAuthService.verifyAccessJwt(withToken(), undefined, 'aud')).rejects.toThrow(
      /Missing required JWT verification configuration/,
    );
  });

  it('rejects a multi-audience POLICY_AUD rather than verifying against the first', async () => {
    // Verifying against the first of several audiences would accept a token
    // minted for a different one.
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://t', 'aud1,aud2')).rejects.toThrow(
      /Multiple JWT audiences are not supported/,
    );
  });

  it('rejects a blank POLICY_AUD', async () => {
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://t', ' '.repeat(3))).rejects.toThrow(
      /Missing required JWT verification configuration/,
    );
  });

  it('reports a verification failure as unauthorized, not internal', async () => {
    // Any jose failure — bad signature, wrong issuer, expired, malformed — must
    // surface as a 401. Letting it escape as-is would leak library internals.
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.invalid', 'aud')).rejects.toThrow(
      /^JWT verification failed\.$/,
    );
    await expect(AccessAuthService.verifyAccessJwt(withToken(), 'https://team.invalid', 'aud')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('does not echo the jose error detail to the client', async () => {
    // The verifier's internals (expected issuer, audience, cert URL) must not
    // leak into the response — they go to the log instead.
    const failure = await AccessAuthService.verifyAccessJwt(withToken(), 'https://team.invalid', 'aud').catch((error: unknown) => error);
    expect((failure as Error).message).toBe('JWT verification failed.');
  });
});
