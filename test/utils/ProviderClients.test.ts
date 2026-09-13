import { describe, it, expect, vi } from 'vitest';
import { StsClient } from '@aws-access-bridge/provider-clients/aws';
import { CostExplorerClient } from '@aws-access-bridge/provider-clients/aws';
import { IamClient } from '@aws-access-bridge/provider-clients/aws';
import { parseXmlTag } from '@aws-access-bridge/provider-clients/aws';
import { UnauthorizedError } from '@aws-access-bridge/backend-errors';

function signedFetch(response: Response) {
  return () => ({ fetch: vi.fn().mockResolvedValue(response) }) as never;
}

describe('provider-clients AWS parsers', () => {
  it('parseXmlTag extracts first occurrences', () => {
    expect(parseXmlTag('<A>x</A><A>y</A>', 'A')).toBe('x');
    expect(parseXmlTag('<B/>', 'A')).toBeUndefined();
  });

  it('StsClient parses AssumeRole credentials', async () => {
    const xml = `<AssumeRoleResponse><Credentials><AccessKeyId>AK</AccessKeyId><SecretAccessKey>SK</SecretAccessKey><SessionToken>ST</SessionToken><Expiration>E</Expiration></Credentials></AssumeRoleResponse>`;
    const client = new StsClient(signedFetch(new Response(xml, { status: 200 })));
    await expect(client.assumeRole('arn', { accessKeyId: 'a', secretAccessKey: 'b' }, 's')).resolves.toMatchObject({
      accessKeyId: 'AK',
      expiration: 'E',
    });
  });

  it('StsClient maps failed calls to Unauthorized', async () => {
    const client = new StsClient(signedFetch(new Response('denied', { status: 403, statusText: 'Forbidden' })));
    await expect(client.assumeRole('arn', { accessKeyId: 'a', secretAccessKey: 'b' }, 's')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('CostExplorerClient aggregates service breakdowns', async () => {
    const body = JSON.stringify({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
          Groups: [
            { Keys: ['EC2'], Metrics: { UnblendedCost: { Amount: '1.5', Unit: 'USD' } } },
            { Keys: ['S3'], Metrics: { UnblendedCost: { Amount: '0', Unit: 'USD' } } },
          ],
        },
      ],
    });
    const client = new CostExplorerClient(signedFetch(new Response(body, { status: 200 })));
    const results = await client.getCostAndUsage({ accessKeyId: 'a', secretAccessKey: 'b' }, '2025-01-01', '2025-01-02');
    expect(results[0]).toMatchObject({ totalCost: 1.5, currency: 'USD', serviceBreakdown: { EC2: 1.5 } });
  });

  it('IamClient parses members and maps AccessDenied to BadRequest', async () => {
    const xml = `<ListRolesResponse><member><RoleName>Dev</RoleName><Arn>arn:dev</Arn><Description>d</Description></member></ListRolesResponse>`;
    const client = new IamClient(signedFetch(new Response(xml, { status: 200 })));
    await expect(client.listRoles({ accessKeyId: 'a', secretAccessKey: 'b' })).resolves.toEqual([
      { roleName: 'Dev', arn: 'arn:dev', description: 'd' },
    ]);
    const denied = new IamClient(signedFetch(new Response('AccessDenied', { status: 403 })));
    await expect(denied.listRoles({ accessKeyId: 'a', secretAccessKey: 'b' })).rejects.toThrow('iam:ListRoles');
  });
});
