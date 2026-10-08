import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { createRemoteJWKSet as CreateRemoteJWKSet } from 'jose';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { DEMO_USER_EMAIL } from '@aws-access-bridge/shared/constants';
import type { ServiceEnv } from '../composition/ServiceEnv';

import { log } from '@aws-access-bridge/shared/utils';
type AccessAuthEnv = ServiceEnv;

// Minimal structural view of the Workers runtime ExecutionContext when
// Worker-level Cloudflare Access is enabled. The platform attaches
// `ctx.access` only after it has authenticated the request itself, so an
// identity read here is platform-verified (unlike the spoofable
// `Cf-Access-Authenticated-User-Email` request header, which must never be
// trusted). See https://developers.cloudflare.com/workers/configuration/cloudflare-access/
interface AccessIdentityContext {
  access?: {
    getIdentity: () => Promise<{ email?: string | null } | null>;
  };
}

/**
 * One remote JWKS per team domain, cached process-wide. A fresh
 * `createRemoteJWKSet` per request re-fetches the certs endpoint on every
 * token verification — a needless dependency on the team domain's latency on
 * the hot auth path.
 */
const jwksCache: Map<string, ReturnType<typeof CreateRemoteJWKSet>> = new Map();

function remoteJwksFor(teamDomain: string): ReturnType<typeof CreateRemoteJWKSet> {
  const url: string = `${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/**
 * Test-only: drop the memoized JWKS fetchers so a test re-pointing at a
 * different certs endpoint does not inherit another test's cache.
 */
function resetJwksCacheForTests(): void {
  jwksCache.clear();
}

class AccessAuthService {
  constructor(private readonly env: AccessAuthEnv) {}

  public async getAuthenticatedUserEmail(request: Request, accessCtx?: AccessIdentityContext): Promise<string> {
    if (ConfigurationManager.auth.isDemoMode(this.env)) {
      return DEMO_USER_EMAIL;
    }
    // Local-only bypass for integration tests and `wrangler dev`. Never set in production.
    if (this.env.DEV_AUTH_EMAIL) {
      // Fail closed rather than authenticate. Read before JWT verification and
      // with no environment guard, a `DEV_AUTH_EMAIL` promoted from a `.dev.vars`
      // would authenticate *every* caller as that address — including as
      // super-admin, and for `/api/aws/assume-role`. The integration suite sets
      // it in vars, which is exactly the mistake being guarded against, so it is
      // honoured only when the environment says it is not a real deployment.
      if (ConfigurationManager.environment.isProduction(this.env)) {
        throw new InternalServerError('DEV_AUTH_EMAIL is set in a production environment. Remove it and redeploy.');
      }
      log.warn('Bypassing Cloudflare Access: DEV_AUTH_EMAIL is set. This is only safe outside production.');
      return this.env.DEV_AUTH_EMAIL;
    }
    const teamDomain: string | undefined = ConfigurationManager.auth.getTeamDomain(this.env);
    const policyAud: string | undefined = ConfigurationManager.auth.getPolicyAud(this.env);
    if (teamDomain && policyAud) {
      return AccessAuthService.verifyAccessJwt(request, teamDomain, policyAud);
    }
    // No explicit JWT config: fall back to the platform-verified identity
    // (Worker-level Access). Required for same-account deploys that rely on
    // one-click Access instead of `POLICY_AUD`/`TEAM_DOMAIN` vars.
    const identity = await accessCtx?.access?.getIdentity?.().catch(() => null);
    const email = identity?.email;
    return email || AccessAuthService.verifyAccessJwt(request, teamDomain, policyAud);
  }

  public static async verifyAccessJwt(request: Request, teamDomain?: string, policyAud?: string): Promise<string> {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      throw new UnauthorizedError('No Cloudflare Access JWT token provided in request headers.');
    }

    if (!teamDomain || !policyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }

    let normalizedTeamDomainEnd: number = teamDomain.length;
    while (normalizedTeamDomainEnd > 0 && teamDomain.charAt(normalizedTeamDomainEnd - 1) === '/') {
      normalizedTeamDomainEnd -= 1;
    }
    const normalizedTeamDomain: string = teamDomain.slice(0, normalizedTeamDomainEnd);
    const normalizedPolicyAud: string = policyAud.trim();
    if (!normalizedPolicyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }
    if (normalizedPolicyAud.includes(',')) {
      throw new UnauthorizedError('Multiple JWT audiences are not supported. Configure a single POLICY_AUD value.');
    }

    try {
      const JWKS = remoteJwksFor(normalizedTeamDomain);
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: normalizedTeamDomain,
        audience: normalizedPolicyAud,
      });

      const email = payload.email as string;
      if (!email) {
        throw new UnauthorizedError('No email found in JWT token.');
      }
      return email;
    } catch (error) {
      // The jose error text can name the expected issuer/audience or leak
      // internals of the cert fetch — log it, but answer with a generic
      // message so the client learns nothing about the verifier's config.
      if (error instanceof UnauthorizedError) throw error;
      log.warn('JWT verification failed:', { error: error instanceof Error ? error.message : error });
      throw new UnauthorizedError('JWT verification failed.');
    }
  }
}
export { AccessAuthService, resetJwksCacheForTests };
export type { AccessAuthEnv, AccessIdentityContext };
