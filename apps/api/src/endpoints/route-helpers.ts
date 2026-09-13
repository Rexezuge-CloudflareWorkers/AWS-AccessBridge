import { BaseUrlUtil } from '@aws-access-bridge/backend-services/aws';
import { D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED } from '@aws-access-bridge/backend-data/constants/d1';
import { DEFAULT_DEMO_MODE } from '@aws-access-bridge/shared/constants';

/**
 * Session/Demo/BaseUrl helpers extracted from the fat
 * `IActivityAPIRoute` god-base (Otter `IUserRoute` split precedent).
 * `IActivityAPIRoute` keeps `handle/toResponse/toErrorResponse`;
 * auth/session/env concerns live here.
 */
function withUnconstrainedD1Session<TEnv>(env: TEnv): TEnv {
  const db = (env as Record<string, { withSession?: (constraint: unknown) => unknown }>).AccessBridgeDB;
  if (db && typeof db.withSession === 'function') {
    return { ...(env as object), AccessBridgeDB: db.withSession(D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED) } as TEnv;
  }
  return env;
}

function isDemoModeEnv(env: unknown): boolean {
  return ((env as Record<string, string | undefined>).DEMO_MODE ?? DEFAULT_DEMO_MODE) === 'true';
}

function getRequestBaseUrl(request: Request, env: unknown): string {
  return BaseUrlUtil.getBaseUrl(request, env);
}

function getQueryParam(request: Request, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined;
}

export { getQueryParam, getRequestBaseUrl, isDemoModeEnv, withUnconstrainedD1Session };
