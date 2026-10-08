import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { IamService } from '@aws-access-bridge/backend-services/aws/iam';
import { CostExplorerService } from '@aws-access-bridge/backend-services/aws/ce';
import { BadRequestError, ForbiddenError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
import type { AccessKeys } from '@aws-access-bridge/shared/model';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEYS: AccessKeys = { accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'token' };

const ASSUME_XML = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
<AccessKeyId>ASIA</AccessKeyId><SecretAccessKey>shh</SecretAccessKey>
<SessionToken>tok</SessionToken><Expiration>2025-01-01T00:00:00Z</Expiration>
</Credentials></AssumeRoleResult></AssumeRoleResponse>`;

function xmlResponse(xml: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => xml,
    arrayBuffer: async () => new TextEncoder().encode(xml).buffer,
  } as Response;
}

describe('StsService.assumeRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assumes a role and parses credentials', async () => {
    mockFetch.mockResolvedValue(xmlResponse(ASSUME_XML));
    const result = await new StsService().assumeRole('arn:aws:iam::123456789012:role/Dev', KEYS, 'session');
    expect(result.accessKeyId).toBe('ASIA');
    expect(result.expiration).toBe('2025-01-01T00:00:00Z');
  });

  it('throws ForbiddenError when STS rejects with a 403', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new StsService().assumeRole('arn:aws:iam::123456789012:role/Dev', KEYS, 's')).rejects.toThrow(ForbiddenError);
  });

  it('throws UnauthorizedError for non-403 failures', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 401));
    await expect(new StsService().assumeRole('arn:aws:iam::123456789012:role/Dev', KEYS, 's')).rejects.toThrow(UnauthorizedError);
  });

  it('throws InternalServerError on unparseable responses', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<AssumeRoleResponse/>'));
    await expect(new StsService().assumeRole('arn:aws:iam::123456789012:role/Dev', KEYS, 's')).rejects.toThrow(InternalServerError);
  });
});

describe('StsService.validateCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns identity on success', async () => {
    mockFetch.mockResolvedValue(
      xmlResponse(
        '<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/x</Arn><Account>123456789012</Account><UserId>AIDA</UserId></GetCallerIdentityResult></GetCallerIdentityResponse>',
      ),
    );
    const identity = await new StsService().validateCredentials('AKIA', 'secret');
    expect(identity.accountId).toBe('123456789012');
    expect(identity.userId).toBe('AIDA');
  });

  it('throws BadRequestError on invalid credentials', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new StsService().validateCredentials('bad', 'bad')).rejects.toThrow(BadRequestError);
  });

  it('throws InternalServerError on unparseable responses', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<GetCallerIdentityResponse/>'));
    await expect(new StsService().validateCredentials('AKIA', 'secret')).rejects.toThrow(InternalServerError);
  });
});

describe('IamService.listRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ROLES_XML = `<ListRolesResponse><ListRolesResult><Roles><member>
<RoleName>Dev</RoleName><Arn>arn:aws:iam::123456789012:role/Dev</Arn><Description>d</Description>
</member><member><RoleName>Ops</RoleName><Arn>arn:aws:iam::123456789012:role/Ops</Arn></member></Roles></ListRolesResult></ListRolesResponse>`;

  it('lists roles with descriptions', async () => {
    mockFetch.mockResolvedValue(xmlResponse(ROLES_XML));
    const roles = await new IamService().listRoles(KEYS);
    expect(roles).toHaveLength(2);
    expect(roles[0]).toEqual({ roleName: 'Dev', arn: 'arn:aws:iam::123456789012:role/Dev', description: 'd' });
    expect(roles[1]?.description).toBe('');
  });

  it('throws BadRequestError on AccessDenied', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error><Code>AccessDenied</Code></Error>', false, 403));
    await expect(new IamService().listRoles(KEYS)).rejects.toThrow(BadRequestError);
  });

  it('throws InternalServerError on other failures', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new IamService().listRoles(KEYS)).rejects.toThrow(InternalServerError);
  });
});

describe('CostExplorerService.getCostAndUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates service costs per period', async () => {
    const body = JSON.stringify({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
          Groups: [
            { Keys: ['Amazon EC2'], Metrics: { UnblendedCost: { Amount: '1.5', Unit: 'USD' } } },
            { Keys: ['Amazon S3'], Metrics: { UnblendedCost: { Amount: '0', Unit: 'USD' } } },
          ],
        },
      ],
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    });
    const results = await new CostExplorerService().getCostAndUsage(KEYS, '2025-01-01', '2025-01-02');
    expect(results).toHaveLength(1);
    expect(results[0]?.totalCost).toBe(1.5);
    expect(results[0]?.serviceBreakdown).toEqual({ 'Amazon EC2': 1.5 });
  });

  it('throws InternalServerError when Cost Explorer rejects', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'nope',
      arrayBuffer: async () => new TextEncoder().encode('nope').buffer,
    });
    await expect(new CostExplorerService().getCostAndUsage(KEYS, '2025-01-01', '2025-01-02')).rejects.toThrow(InternalServerError);
  });
});
