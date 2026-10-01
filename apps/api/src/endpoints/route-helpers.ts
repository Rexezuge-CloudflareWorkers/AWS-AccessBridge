import { BaseUrlUtil } from '@aws-access-bridge/backend-services/aws';
import { createD1SessionEnv } from '@aws-access-bridge/backend-data/utils';
import { DEFAULT_DEMO_MODE } from '@aws-access-bridge/shared/constants';

/**
 * Session/Demo/BaseUrl helpers extracted from the fat
 * `IActivityAPIRoute` god-base (Otter `IUserRoute` split precedent).
 * `IActivityAPIRoute` keeps `handle/toResponse/toErrorResponse`;
 * auth/session/env concerns live here.
 */

/**
 * Route reads through a first-replica session, for read-your-writes.
 *
 * Delegates to `createD1SessionEnv`, which was duplicated here inline. Takes a
 * loose env shape because `IEnv.AccessBridgeDB` is already narrowed to
 * `D1DatabaseSession` by the route base.
 */
function withUnconstrainedD1Session<TEnv extends { AccessBridgeDB: D1Database | D1DatabaseSession }>(env: TEnv): TEnv {
  return createD1SessionEnv(env as unknown as { AccessBridgeDB: D1Database }) as unknown as TEnv;
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
