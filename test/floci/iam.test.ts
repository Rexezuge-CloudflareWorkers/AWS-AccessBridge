import { describe, expect, it } from 'vitest';
import { IamService } from '@aws-access-bridge/backend-services/aws';
import { ACCOUNT_A, accountKeys, flociClientFactory } from './helpers/floci';
import { createRole } from './helpers/seed';

/**
 * Role discovery over a real signed round trip.
 *
 * This is the path the Setup Wizard's "discover roles" step drives, and the one
 * `IamClient` degrades on: an `AccessDenied` body becomes a `BadRequestError`
 * telling the user to enter names by hand. Both branches matter, so both are
 * covered — the second one needs no permission model, only a role that exists.
 */
describe('IAM role discovery against Floci', () => {
  it('parses roles from a real ListRoles response', async () => {
    const roleName = 'floci-iam-discovered';
    const arn = await createRole(roleName);
    const service = new IamService(flociClientFactory());

    const roles = await service.listRoles(accountKeys(ACCOUNT_A));

    const found = roles.find((role) => role.roleName === roleName);
    expect(found).toBeDefined();
    expect(found?.arn).toBe(arn);
    // `Description` is optional on the wire and the parser defaults it to ''.
    // Asserting the default rather than skipping it keeps a missing-tag
    // regression from showing up as an absent key instead.
    expect(found?.description).toBe('');
  });

  it('returns every discovered role fully populated', async () => {
    await createRole('floci-iam-alpha');
    await createRole('floci-iam-beta');
    const service = new IamService(flociClientFactory());

    const roles = await service.listRoles(accountKeys(ACCOUNT_A));

    const names = roles.map((role) => role.roleName);
    expect(names).toContain('floci-iam-alpha');
    expect(names).toContain('floci-iam-beta');
    for (const role of roles) {
      expect(role.roleName).toBeTruthy();
      expect(role.arn).toMatch(/^arn:aws:iam::\d{12}:role\//);
      expect(typeof role.description).toBe('string');
    }
  });
});
