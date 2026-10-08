import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenService } from '@aws-access-bridge/backend-services/auth';
import { UserAccessTokenDAO } from '@aws-access-bridge/backend-data/dao/UserAccessTokenDAO';
import { ConsoleService } from '@aws-access-bridge/backend-services/aws/console';
import { InternalRequestHelper } from '@aws-access-bridge/backend-services/aws/InternalRequestHelper';
import { UnauthorizedError, InternalServerError } from '@aws-access-bridge/backend-errors';
import { buildPrincipalArn } from '@aws-access-bridge/shared/utils/aws';

vi.mock('@aws-access-bridge/backend-data/dao/UserAccessTokenDAO');

const mockFetch = vi.fn();

function tokenService() {
  return new TokenService({ AccessBridgeDB: {} as never });
}

describe('TokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the user email for valid tokens and touches last-used', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByTokenHash).mockResolvedValue({ userEmail: 'user@example.com' } as never);
    vi.mocked(UserAccessTokenDAO.prototype.updateLastUsedByTokenHash).mockResolvedValue(undefined);
    await expect(tokenService().authenticateWithPAT('token')).resolves.toBe('user@example.com');
    expect(UserAccessTokenDAO.prototype.updateLastUsedByTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('throws UnauthorizedError for invalid tokens', async () => {
    vi.mocked(UserAccessTokenDAO.prototype.getByTokenHash).mockResolvedValue(undefined);
    await expect(tokenService().authenticateWithPAT('bad')).rejects.toThrow(UnauthorizedError);
  });
});

describe('ConsoleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the signin token on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ SigninToken: 'tok', Expiration: 'x' }),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ SigninToken: 'tok', Expiration: 'x' })).buffer,
    });
    await expect(new ConsoleService().getSigninToken('AKIA', 'secret')).resolves.toBe('tok');
  });

  it('throws UnauthorizedError on 400', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
    });
    await expect(new ConsoleService().getSigninToken('bad', 'bad')).rejects.toThrow(UnauthorizedError);
  });

  it('throws InternalServerError on other failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
      arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
    });
    await expect(new ConsoleService().getSigninToken('AKIA', 'secret')).rejects.toThrow(InternalServerError);
  });

  it('builds login URLs with issuer and destination', () => {
    const url = new ConsoleService().getLoginUrl('tok', 'https://example.com', 'https://console.aws.amazon.com/ec2');
    expect(url).toContain('Action=login');
    expect(url).toContain('SigninToken=tok');
    expect(url).toContain(encodeURIComponent('https://console.aws.amazon.com/ec2'));
  });
});

describe('InternalRequestHelper', () => {
  it('signs requests with internal headers and forwards via fetcher', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'));
    const fetcher = { fetch: fetchSpy } as unknown as Fetcher;
    const helper = new InternalRequestHelper(fetcher, 'test-secret');
    const response = await helper.makeRequest('/api/aws/assume-role', 'POST', '{"a":1}', 'https://example.com', 'user@example.com');
    expect(response).toBeInstanceOf(Response);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://self.invalid/api/aws/assume-role');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-internal-user-email']).toBe('user@example.com');
    expect(headers['x-internal-signature']).toMatch(/^[A-Z0-9+/=]+$/i);
    expect(headers['x-internal-timestamp']).toMatch(/^\d+$/);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits content-type for bodiless requests', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'));
    const helper = new InternalRequestHelper({ fetch: fetchSpy } as unknown as Fetcher, 'test-secret');
    await helper.makeRequest('/api/aws/federate', 'GET', null, 'https://example.com', 'user@example.com');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('shared aws utils', () => {
  it('builds principal ARNs', () => {
    expect(buildPrincipalArn('123456789012', 'Dev')).toBe('arn:aws:iam::123456789012:role/Dev');
  });
});
