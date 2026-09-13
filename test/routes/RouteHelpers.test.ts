import { describe, it, expect, vi } from 'vitest';
import { getQueryParam, getRequestBaseUrl, isDemoModeEnv, withUnconstrainedD1Session } from '@/endpoints/route-helpers';

describe('route-helpers', () => {
  it('withUnconstrainedD1Session wraps databases exposing withSession', () => {
    const session = { scoped: true };
    const withSession = vi.fn().mockReturnValue(session);
    const out = withUnconstrainedD1Session({ AccessBridgeDB: { withSession }, other: 1 });
    expect(withSession).toHaveBeenCalledOnce();
    expect(out.AccessBridgeDB).toBe(session);
  });

  it('withUnconstrainedD1Session passes through envs without sessions', () => {
    const env = { AccessBridgeDB: {} };
    expect(withUnconstrainedD1Session(env).AccessBridgeDB).toBe(env.AccessBridgeDB);
  });

  it('isDemoModeEnv honors explicit, missing, and default flags', () => {
    expect(isDemoModeEnv({ DEMO_MODE: 'true' })).toBe(true);
    expect(isDemoModeEnv({ DEMO_MODE: 'false' })).toBe(false);
    expect(isDemoModeEnv({})).toBe(false);
  });

  it('getQueryParam reads present and absent params', () => {
    const request = new Request('https://example.com/x?teamId=t1');
    expect(getQueryParam(request, 'teamId')).toBe('t1');
    expect(getQueryParam(request, 'missing')).toBeUndefined();
  });

  it('getRequestBaseUrl derives origin from request URL', () => {
    expect(getRequestBaseUrl(new Request('https://bridge.example.com/user/me'), {})).toContain('bridge.example.com');
  });
});
