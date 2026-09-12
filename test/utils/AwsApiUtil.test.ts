import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StsService } from '@aws-access-bridge/backend-services/aws/sts';
import { IamService } from '@aws-access-bridge/backend-services/aws/iam';
import { CostExplorerService } from '@aws-access-bridge/backend-services/aws/ce';
import { Ec2Collector } from '@aws-access-bridge/backend-services/aws/collectors/Ec2Collector';
import { S3Collector } from '@aws-access-bridge/backend-services/aws/collectors/S3Collector';
import { LambdaCollector } from '@aws-access-bridge/backend-services/aws/collectors/LambdaCollector';
import { DynamoDbCollector } from '@aws-access-bridge/backend-services/aws/collectors/DynamoDbCollector';
import { RdsCollector } from '@aws-access-bridge/backend-services/aws/collectors/RdsCollector';
import { CollectorRegistry } from '@aws-access-bridge/backend-services/aws/collectors/CollectorRegistry';
import { BadRequestError, InternalServerError, UnauthorizedError } from '@aws-access-bridge/backend-errors';
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
  return { ok, status, statusText: ok ? 'OK' : 'Error', text: async () => xml } as Response;
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

  it('throws UnauthorizedError when STS rejects', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
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
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => body } as Response);
    const results = await new CostExplorerService().getCostAndUsage(KEYS, '2025-01-01', '2025-01-02');
    expect(results).toHaveLength(1);
    expect(results[0]?.totalCost).toBe(1.5);
    expect(results[0]?.serviceBreakdown).toEqual({ 'Amazon EC2': 1.5 });
  });

  it('throws InternalServerError when Cost Explorer rejects', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, text: async () => 'nope' } as Response);
    await expect(new CostExplorerService().getCostAndUsage(KEYS, '2025-01-01', '2025-01-02')).rejects.toThrow(InternalServerError);
  });
});

describe('resource collectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describes EC2 instances with names', async () => {
    mockFetch.mockResolvedValue(
      xmlResponse(`<DescribeInstancesResponse><reservationSet><item><instancesSet><item>
<instanceId>i-1</instanceId><instanceState><name>running</name></instanceState>
<tagSet><item><key>Name</key><value>web</value></item></tagSet>
</item></instancesSet></item></reservationSet></DescribeInstancesResponse>`),
    );
    const items = await new Ec2Collector().collect(KEYS);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.resourceId).toBe('i-1');
  });

  it('returns empty on EC2 failure', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new Ec2Collector().collect(KEYS)).resolves.toEqual([]);
  });

  it('lists S3 buckets', async () => {
    mockFetch.mockResolvedValue(
      xmlResponse('<ListAllMyBucketsResult><Buckets><Bucket><Name>b1</Name></Bucket></Buckets></ListAllMyBucketsResult>'),
    );
    const items = await new S3Collector().collect(KEYS);
    expect(items[0]).toMatchObject({ resourceType: 's3', resourceId: 'b1' });
  });

  it('returns empty on S3 failure', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new S3Collector().collect(KEYS)).resolves.toEqual([]);
  });

  it('lists Lambda functions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        Functions: [{ FunctionName: 'fn', FunctionArn: 'arn:fn', State: 'Active', Runtime: 'nodejs22.x', MemorySize: 128 }],
      }),
      text: async () => '{}',
    } as unknown as Response);
    const items = await new LambdaCollector().collect(KEYS);
    expect(items[0]).toMatchObject({ resourceType: 'lambda', resourceName: 'fn' });
  });

  it('returns empty on Lambda failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'x' } as Response);
    await expect(new LambdaCollector().collect(KEYS)).resolves.toEqual([]);
  });

  it('lists DynamoDB tables', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ TableNames: ['t1'] }),
      text: async () => '{}',
    } as unknown as Response);
    const items = await new DynamoDbCollector().collect(KEYS);
    expect(items[0]).toMatchObject({ resourceType: 'dynamodb', resourceName: 't1' });
  });

  it('lists RDS instances', async () => {
    mockFetch.mockResolvedValue(
      xmlResponse(`<DescribeDBInstancesResult><DBInstances><DBInstance>
<DBInstanceIdentifier>db1</DBInstanceIdentifier><DBInstanceStatus>available</DBInstanceStatus><Engine>postgres</Engine>
</DBInstance></DBInstances></DescribeDBInstancesResult>`),
    );
    const items = await new RdsCollector().collect(KEYS);
    expect(items[0]).toMatchObject({ resourceType: 'rds', resourceId: 'db1', state: 'available' });
  });

  it('returns empty on RDS failure', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<Error/>', false, 403));
    await expect(new RdsCollector().collect(KEYS)).resolves.toEqual([]);
  });
});

describe('CollectorRegistry', () => {
  it('resolves every registered collector by resource type', () => {
    for (const resourceType of ['ec2', 's3', 'lambda', 'rds', 'dynamodb']) {
      expect(CollectorRegistry.get(resourceType).resourceType).toBe(resourceType);
    }
    expect(CollectorRegistry.getAll().size).toBe(5);
  });

  it('rejects unknown resource types', () => {
    expect(() => CollectorRegistry.get('nope')).toThrow(BadRequestError);
  });
});
