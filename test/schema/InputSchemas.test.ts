import { describe, it, expect } from 'vitest';
import { RequestInputSchemas } from '@aws-access-bridge/shared/schema/input';
import {
  AwsAccountIdSchema,
  AwsIamPrincipalArnSchema,
  AwsRegionSchema,
  AwsRoleSessionDurationSecondsSchema,
  EmailSchema,
  nonNegativeIntegerQuerySchema,
  positiveIntegerQuerySchema,
} from '@aws-access-bridge/shared/schema/common';

/**
 * These schemas are the request boundary: every field a route accepts is validated
 * here before `handleRequest` runs. They had **zero** function coverage and 54.5%
 * branch coverage, which for a validation boundary means the rejections were
 * largely unexercised — and a schema that silently stopped rejecting is a security
 * regression nothing would notice.
 *
 * Reached through `RequestInputSchemas`, which is the module's only value export
 * and the contract every route actually uses, so these assertions are about the
 * real `METHOD /path` wiring rather than about private declarations.
 *
 * Both directions are asserted. A permissive schema that accepts junk, and a strict
 * one that rejects valid input — the second is the failure nobody notices until a
 * user cannot do their job.
 */

type AnySchema = { safeParse: (value: unknown) => { success: boolean } };

/**
 * Indexed through a widened alias: `RequestInputSchemas` is `as const`, so a
 * computed `${method} ${path}` key is not assignable to its literal-keyed type even
 * though every key used here exists in it.
 */
const ROUTES: Record<string, { body?: AnySchema; query?: AnySchema }> = RequestInputSchemas;

/**
The body schema bound to a route, or undefined if it declares none.
*/
function bodyOf(method: string, path: string): AnySchema | undefined {
  return ROUTES[`${method} ${path}`]?.body;
}

function queryOf(method: string, path: string): AnySchema | undefined {
  return ROUTES[`${method} ${path}`]?.query;
}

/**
`true` when the route's body accepts the payload.
*/
function acceptsBody(method: string, path: string, payload: unknown): boolean {
  return bodyOf(method, path)?.safeParse(payload).success ?? false;
}

function acceptsQuery(method: string, path: string, payload: unknown): boolean {
  return queryOf(method, path)?.safeParse(payload).success ?? false;
}

describe('every registered route', () => {
  it('exposes a schema for a body where one is required', () => {
    // A POST with no body schema would pass its raw input straight to the service.
    for (const [key, schema] of Object.entries(ROUTES)) {
      const [method, path] = key.split(' ', 2);
      if (method === 'POST' && path !== '/user/admin/maintenance/cleanup-orphaned' && path !== '/user/admin/collection/config') {
        expect(schema.body, key).toBeDefined();
      }
    }
  });

  it('declares a query schema for every GET', () => {
    // `GET /user/me` is authenticated-only and takes no input, so it is the one
    // documented exception.
    for (const [key, schema] of Object.entries(ROUTES)) {
      const [method, path] = key.split(' ', 2);
      if (method === 'GET' && path !== '/user/me') {
        expect(schema.query, key).toBeDefined();
      }
    }
  });

  it('validates identically on the programmatic and browser surfaces', () => {
    // The same route class serves both, so a divergence would mean one surface
    // validates differently from the other — the kind of mismatch nothing notices,
    // because both routes keep working. Compared by *behaviour* rather than
    // identity: the two map entries name equal but distinct Zod instances.
    const probe = { awsAccountId: '123456789012', destinationPath: 'ec2/home', role: 'Admin', roleName: 'Admin' };
    for (const [apiKey, userKey] of [
      ['POST /api/aws/console', 'POST /user/aws/console'],
      ['POST /api/aws/assume-role', 'POST /user/aws/assume-role'],
      ['GET /api/aws/federate', 'GET /user/aws/federate'],
    ] as const) {
      const api = ROUTES[apiKey];
      const user = ROUTES[userKey];
      for (const payload of [probe, {}, { role: 'x', awsAccountId: 'bad' }]) {
        expect(api?.body?.safeParse(payload).success ?? api?.query?.safeParse(payload).success, apiKey).toBe(
          user?.body?.safeParse(payload).success ?? user?.query?.safeParse(payload).success,
        );
      }
    }
  });
});

describe('principal ARN schema', () => {
  it('accepts a role and a user ARN', () => {
    expect(AwsIamPrincipalArnSchema.safeParse('arn:aws:iam::123456789012:role/Dev').success).toBe(true);
    expect(AwsIamPrincipalArnSchema.safeParse('arn:aws:iam::123456789012:user/alice').success).toBe(true);
  });

  /**
   * The role/user restriction is the point: an ARN naming anything else is not
   * something this app can assume, and letting it through would reach STS.
   */
  it('rejects other principal types', () => {
    for (const arn of [
      'arn:aws:iam::123456789012:policy/Admin',
      'arn:aws:iam::123456789012:group/Admins',
      'arn:aws:s3:::my-bucket',
      'not-an-arn',
      '',
    ]) {
      expect(AwsIamPrincipalArnSchema.safeParse(arn).success, arn).toBe(false);
    }
  });

  it('accepts a role in a path, which IAM really does use', () => {
    // `role/<path>/<name>` is a legitimate ARN form: the policy is rooted at
    // `role/`, not at a two-segment shape, and narrowing it would refuse real roles.
    expect(AwsIamPrincipalArnSchema.safeParse('arn:aws:iam::123456789012:role/team/Dev').success).toBe(true);
  });

  it('rejects an account id that is not exactly twelve digits', () => {
    expect(AwsIamPrincipalArnSchema.safeParse('arn:aws:iam::12345:role/Dev').success).toBe(false);
    expect(AwsIamPrincipalArnSchema.safeParse('arn:aws:iam::12345678901234:role/Dev').success).toBe(false);
  });

  it('is what the assume-role routes actually validate against', () => {
    expect(acceptsBody('POST', '/user/aws/assume-role', { principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(true);
    expect(acceptsBody('POST', '/user/aws/assume-role', { principalArn: 'arn:aws:iam::123456789012:policy/Admin' })).toBe(false);
    expect(acceptsBody('POST', '/user/aws/assume-role', {})).toBe(false);
  });
});

describe('account id schema', () => {
  it('accepts twelve digits', () => {
    expect(AwsAccountIdSchema.safeParse('123456789012').success).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['12345678901', '1234567890123', '12345678901a', '', 'arn:aws:iam::123456789012:role/Dev']) {
      expect(AwsAccountIdSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('email schema', () => {
  it('accepts an ordinary address', () => {
    expect(EmailSchema.safeParse('alice@example.com').success).toBe(true);
  });

  /**
   * An over-long address is either a mistake or an attempt to smuggle a payload
   * into a column sized for an address, so it is refused at the boundary rather
   * than at the database.
   */
  it('rejects a malformed or over-long address', () => {
    for (const value of ['not-an-email', 'a@', '@example.com', `${'a'.repeat(320)}@example.com`]) {
      expect(EmailSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('region schema', () => {
  it('accepts a commercial and a GovCloud region', () => {
    for (const region of ['us-east-1', 'eu-west-1', 'us-gov-west-1']) {
      expect(AwsRegionSchema.safeParse(region).success, region).toBe(true);
    }
  });

  it('rejects a region-shaped string that is not one', () => {
    for (const region of ['useast1', 'us-east', 'not a region', '../../etc/passwd']) {
      expect(AwsRegionSchema.safeParse(region).success, region).toBe(false);
    }
  });

  it('is optional, because the destination region is', () => {
    expect(AwsRegionSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('role session duration', () => {
  /**
   * AWS itself rejects anything under 900 or over 43200. Validating here turns a
   * confusing STS error into a 400 and stops a caller provoking a re-assumption
   * loop.
   */
  it('accepts the range AWS allows', () => {
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(900).success).toBe(true);
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(3600).success).toBe(true);
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(43_200).success).toBe(true);
  });

  it('rejects a duration outside that range, or a non-integer', () => {
    for (const value of [899, 43_201, 0, -1, 3600.5]) {
      expect(AwsRoleSessionDurationSecondsSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });

  it('is optional, since it defaults', () => {
    expect(AwsRoleSessionDurationSecondsSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('query integer schemas', () => {
  it('accepts a positive integer and transforms it to a number', () => {
    const parsed = positiveIntegerQuerySchema('limit', 200).safeParse('25');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe(25);
  });

  /**
   * The cap is what keeps `LIMIT ?` from being handed an arbitrary number, so it is
   * asserted rather than trusted.
   */
  it('rejects a positive integer above the cap', () => {
    expect(positiveIntegerQuerySchema('limit', 200).safeParse('201').success).toBe(false);
    expect(positiveIntegerQuerySchema('limit', 200).safeParse('200').success).toBe(true);
  });

  it('rejects zero, a negative, a fraction and a non-numeric value', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '', ' 1']) {
      expect(positiveIntegerQuerySchema('limit', 200).safeParse(value).success, value).toBe(false);
    }
  });

  it('accepts zero for a non-negative schema but not a negative', () => {
    const schema = nonNegativeIntegerQuerySchema('offset');
    expect(schema.safeParse('0').success).toBe(true);
    expect(schema.safeParse('-1').success).toBe(false);
    expect(schema.safeParse('abc').success).toBe(false);
  });

  it('is what the paginated listing routes validate against', () => {
    expect(acceptsQuery('GET', '/user/assumables', { limit: '50', offset: '0' })).toBe(true);
    expect(acceptsQuery('GET', '/user/assumables', { limit: '500' })).toBe(false);
    expect(acceptsQuery('GET', '/user/assumables', { offset: '-1' })).toBe(false);
    expect(acceptsQuery('GET', '/user/assumables', {})).toBe(true);
  });

  it('treats showHidden strictly, so a typo does not silently reveal hidden roles', () => {
    expect(acceptsQuery('GET', '/user/assumables', { showHidden: 'true' })).toBe(true);
    expect(acceptsQuery('GET', '/user/assumables', { showHidden: 'false' })).toBe(true);
    expect(acceptsQuery('GET', '/user/assumables', { showHidden: 'yes' })).toBe(false);
    expect(acceptsQuery('GET', '/user/assumables', { showHidden: '1' })).toBe(false);
  });
});

describe('console URL body', () => {
  /**
   * `destinationPath` is a console *path*, not a URL. Accepting an absolute URL
   * here would turn the console endpoint into an open redirect, which is the whole
   * reason the field is validated rather than concatenated.
   */
  // The console body extends the credential body, so every payload needs a key pair.
  const WITH_KEYS = { accessKeyId: 'AKIA', secretAccessKey: 'shh' };

  it('rejects an absolute URL as a destination path', () => {
    // Accepting one here would turn the console endpoint into an open redirect,
    // which is why the field is validated rather than concatenated.
    expect(acceptsBody('POST', '/user/aws/console', { ...WITH_KEYS, destinationPath: 'https://evil.example.com' })).toBe(false);
    expect(acceptsBody('POST', '/user/aws/console', { ...WITH_KEYS, destinationPath: 'javascript:alert(1)' })).toBe(false);
  });

  it('accepts a console path', () => {
    expect(acceptsBody('POST', '/user/aws/console', { ...WITH_KEYS, destinationPath: 'ec2/home#Instances' })).toBe(true);
  });

  /**
   * A partial pair would silently fall back to "use the caller's default", which is
   * a subtly different console session than the one asked for.
   */
  it('requires awsAccountId and roleName together or not at all', () => {
    const base = { ...WITH_KEYS, destinationPath: 'ec2/home' };
    expect(acceptsBody('POST', '/user/aws/console', { ...base, awsAccountId: '123456789012', roleName: 'Admin' })).toBe(true);
    expect(acceptsBody('POST', '/user/aws/console', { ...base })).toBe(true);
    expect(acceptsBody('POST', '/user/aws/console', { ...base, awsAccountId: '123456789012' })).toBe(false);
    expect(acceptsBody('POST', '/user/aws/console', { ...base, roleName: 'Admin' })).toBe(false);
  });
});

describe('credential bodies', () => {
  /**
   * The session token is optional because long-lived IAM user keys legitimately
   * have none; requiring one would reject every such credential.
   */
  it('accepts a key pair with or without a session token', () => {
    expect(acceptsBody('POST', '/user/admin/credentials/validate', { accessKeyId: 'AKIA', secretAccessKey: 'shh' })).toBe(true);
    expect(acceptsBody('POST', '/user/admin/credentials/validate', { accessKeyId: 'AKIA', secretAccessKey: 'shh', sessionToken: 'tok' })).toBe(true);
    expect(acceptsBody('POST', '/user/admin/credentials/validate', { accessKeyId: 'AKIA' })).toBe(false);
  });

  it('requires a relationship to name two principals', () => {
    expect(
      acceptsBody('POST', '/user/admin/credentials/relationship', {
        assumedBy: 'arn:aws:iam::123456789012:user/alice',
        principalArn: 'arn:aws:iam::123456789012:role/Dev',
      }),
    ).toBe(true);
    expect(acceptsBody('POST', '/user/admin/credentials/relationship', { principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(false);
  });
});

describe('team bodies', () => {
  it('requires a non-empty team name within its length cap', () => {
    expect(acceptsBody('POST', '/user/admin/team', { teamName: 'Platform' })).toBe(true);
    expect(acceptsBody('POST', '/user/admin/team', { teamName: '' })).toBe(false);
    expect(acceptsBody('POST', '/user/admin/team', { teamName: ' '.repeat(3) })).toBe(false);
    expect(acceptsBody('POST', '/user/admin/team', { teamName: 'x'.repeat(129) })).toBe(false);
  });

  it('constrains a member role to the two known values', () => {
    const teamId = '8a7e6d5c-4b3a-4290-8271-605f4b3a2110';
    expect(acceptsBody('PUT', '/user/admin/team/member/role', { role: 'admin', teamId, userEmail: 'a@example.com' })).toBe(true);
    expect(acceptsBody('PUT', '/user/admin/team/member/role', { role: 'owner', teamId, userEmail: 'a@example.com' })).toBe(false);
  });

  it('requires a real UUID for a team id, so a crafted path cannot reach another team', () => {
    expect(acceptsBody('DELETE', '/user/admin/team', { teamId: '8a7e6d5c-4b3a-4290-8271-605f4b3a2110' })).toBe(true);
    expect(acceptsBody('DELETE', '/user/admin/team', { teamId: "1' OR '1'='1" })).toBe(false);
    expect(acceptsBody('DELETE', '/user/admin/team', { teamId: 'not-a-uuid' })).toBe(false);
  });
});

describe('collection config', () => {
  /**
   * POST takes a *list* while DELETE takes a single type. This mismatch was a real
   * bug once: the service sent the singular form and nothing caught it because the
   * service had no caller.
   */
  it('takes a list on enable and a single type on disable', () => {
    expect(acceptsBody('POST', '/user/admin/collection/config', { collectionTypes: ['cost', 'resource'], principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(true);
    expect(acceptsBody('POST', '/user/admin/collection/config', { collectionType: 'cost', principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(false);
    expect(acceptsBody('DELETE', '/user/admin/collection/config', { collectionType: 'cost', principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(true);
  });

  it('rejects an unknown collection type', () => {
    expect(acceptsBody('POST', '/user/admin/collection/config', { collectionTypes: ['everything'], principalArn: 'arn:aws:iam::123456789012:role/Dev' })).toBe(false);
  });
});