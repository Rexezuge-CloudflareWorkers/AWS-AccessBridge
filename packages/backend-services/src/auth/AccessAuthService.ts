import { jwtVerify, createRemoteJWKSet } from 'jose';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';
import { DEMO_USER_EMAIL } from '@aws-access-bridge/shared/constants';

interface AccessAuthEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;
}

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

class AccessAuthService {
  constructor(private readonly env: AccessAuthEnv) {}

  public async getAuthenticatedUserEmail(request: Request, accessCtx?: AccessIdentityContext): Promise<string> {
    if (ConfigurationManager.auth.isDemoMode(this.env)) {
      return DEMO_USER_EMAIL;
    }
    // Local-only bypass for integration tests and `wrangler dev`. Never set in production.
    if (this.env.DEV_AUTH_EMAIL) {
      return this.env.DEV_AUTH_EMAIL;
    }
    if (this.env.TEAM_DOMAIN && this.env.POLICY_AUD) {
      return AccessAuthService.verifyAccessJwt(request, this.env.TEAM_DOMAIN, this.env.POLICY_AUD);
    }
    // No explicit JWT config: fall back to the platform-verified identity
    // (Worker-level Access). Required for same-account deploys that rely on
    // one-click Access instead of `POLICY_AUD`/`TEAM_DOMAIN` vars.
    const identity = await accessCtx?.access?.getIdentity?.().catch(() => null);
    const email = identity?.email;
    if (email) {
      return email;
    }
    return AccessAuthService.verifyAccessJwt(request, this.env.TEAM_DOMAIN, this.env.POLICY_AUD);
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
      const JWKS = createRemoteJWKSet(new URL(`${normalizedTeamDomain}/cdn-cgi/access/certs`));
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
      throw new UnauthorizedError(`JWT verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

class AccessAuthServiceFactory {
  public static create(env: AccessAuthEnv): AccessAuthService {
    return new AccessAuthService(env);
  }
}

export { AccessAuthService, AccessAuthServiceFactory };
export type { AccessAuthEnv, AccessIdentityContext };
