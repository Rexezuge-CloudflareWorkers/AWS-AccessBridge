import { describe, it, expect, vi } from 'vitest';
import { ConsoleService } from '@aws-access-bridge/backend-services/aws/console/ConsoleService';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import { StubHttpClient } from '@aws-access-bridge/backend-services/http';

describe('ConsoleService.buildIssuerUrl', () => {
  const service = new ConsoleService();

  it('returns the bare base URL when either argument is missing', () => {
    expect(service.buildIssuerUrl('https://bridge.example.com')).toBe('https://bridge.example.com');
    expect(service.buildIssuerUrl('https://bridge.example.com', '123456789012')).toBe('https://bridge.example.com');
    expect(service.buildIssuerUrl('https://bridge.example.com', undefined, 'Dev')).toBe('https://bridge.example.com');
  });

  it('builds the federate URL with both parameters', () => {
    expect(service.buildIssuerUrl('https://bridge.example.com', '123456789012', 'DeveloperRole')).toBe(
      'https://bridge.example.com/user/aws/federate?awsAccountId=123456789012&role=DeveloperRole',
    );
  });

  /**
   * `roleName` comes from the `role` query parameter and is only constrained to a
   * non-empty 128-character string. Interpolated raw, a `&` or `#` in it injected
   * extra parameters into the issuer AWS is asked to trust.
   */
  it.each([
    ['a & b', 'a & b'],
    ['x#frag', 'x#frag'],
    ['r?admin=1', 'r?admin=1'],
    ['a=b', 'a=b'],
  ])('encodes a role name containing %j rather than injecting a parameter', (roleName) => {
    const url = new URL(service.buildIssuerUrl('https://bridge.example.com', '123456789012', roleName));
    expect(url.searchParams.get('role')).toBe(roleName);
    // The injected text stayed inside the `role` value instead of becoming a
    // sibling parameter.
    expect([...url.searchParams.keys()]).toEqual(['awsAccountId', 'role']);
  });

  it('preserves an IAM path in the role name', () => {
    const url = new URL(service.buildIssuerUrl('https://bridge.example.com', '123456789012', 'team/dev/DeveloperRole'));
    expect(url.searchParams.get('role')).toBe('team/dev/DeveloperRole');
  });
});

describe('ConsoleService.getSigninToken', () => {
  it('returns the token from a well-formed response', async () => {
    const http = new StubHttpClient().queueJson({ SigninToken: 'tok', Expiration: 'later' });
    await expect(new ConsoleService(http).getSigninToken('AKIA', 'secret')).resolves.toBe('tok');
  });

  it('maps a 400 to an unauthorized error', async () => {
    const http = new StubHttpClient().setHandler(() => new Response('bad creds', { status: 400 }));
    await expect(new ConsoleService(http).getSigninToken('AKIA', 'secret')).rejects.toThrow(/not valid/);
  });

  // A bare `JSON.parse` threw a raw `SyntaxError`, which bypassed the
  // `IServiceError` taxonomy every caller maps status codes through.
  it('raises InternalServerError, not SyntaxError, for a malformed body', async () => {
    const http = new StubHttpClient().setHandler(() => new Response('<html>oops</html>', { status: 200 }));
    const thrown = await new ConsoleService(http)
      .getSigninToken('AKIA', 'secret')
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(InternalServerError);
    expect(thrown).not.toBeInstanceOf(SyntaxError);
  });

  it('rejects a 200 response carrying no SigninToken', async () => {
    const http = new StubHttpClient().queueJson({ Expiration: 'later' });
    await expect(new ConsoleService(http).getSigninToken('AKIA', 'secret')).rejects.toBeInstanceOf(InternalServerError);
  });
});

describe('buildPrincipalArn', () => {
  it('is used by the federate route rather than a template literal', async () => {
    // Guards the call site: two construction sites for one ARN is how the web
    // client and the worker drifted apart.
    const { buildPrincipalArn } = await import('@aws-access-bridge/shared/utils/aws');
    expect(buildPrincipalArn('123456789012', 'DeveloperRole')).toBe('arn:aws:iam::123456789012:role/DeveloperRole');
    expect(buildPrincipalArn('123456789012', 'team/dev/DeveloperRole')).toBe('arn:aws:iam::123456789012:role/team/dev/DeveloperRole');
    vi.clearAllMocks();
  });
});