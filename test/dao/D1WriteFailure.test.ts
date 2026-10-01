import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseError } from '@aws-access-bridge/backend-errors';
import { AwsAccountsDAO } from '@aws-access-bridge/backend-data/dao/AwsAccountsDAO';
import { RoleConfigsDAO } from '@aws-access-bridge/backend-data/dao/RoleConfigsDAO';
import { TeamAccountsDAO } from '@aws-access-bridge/backend-data/dao/TeamAccountsDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { ResourceInventoryDAO } from '@aws-access-bridge/backend-data/dao/ResourceInventoryDAO';
import { SpendAlertDAO } from '@aws-access-bridge/backend-data/dao/SpendAlertDAO';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';
import { TeamsDAO } from '@aws-access-bridge/backend-data/dao/TeamsDAO';
import { TeamMembersDAO } from '@aws-access-bridge/backend-data/dao/TeamMembersDAO';
import { AuditLogDAO } from '@aws-access-bridge/backend-data/dao/AuditLogDAO';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';

/**
 * D1 resolves a failed statement with `{success: false}` rather than throwing.
 * Every write must check it: a write that resolves anyway reports success for a
 * row that does not exist, which is how `TeamsDAO.createTeam` returned a teamId
 * that resolved to nothing and how retention pruning logged "pruned 0 rows"
 * while the table grew unbounded.
 */

/** A statement that resolves `success: false` for every `.run()`. */
function failingStatement(): { stmt: Record<string, unknown>; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue({ success: false, error: 'constraint failed' } as unknown as D1Result);
  const stmt = { bind: vi.fn(), run, first: vi.fn(), all: vi.fn() };
  // `bind` returns the statement itself, matching the real D1 builder chain.
  stmt.bind.mockReturnValue(stmt);
  return { stmt, run };
}

function dbWith(stmt: Record<string, unknown>): D1Database {
  return { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;
}

const OWNER = { userId: 'usr_1', anchorEmail: 'user@example.com' };

describe('D1 writes check result.success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AwsAccountsDAO', () => {
    it.each([
      ['ensureAccountExists', (dao: AwsAccountsDAO) => dao.ensureAccountExists('123456789012')],
      ['setAccountNickname', (dao: AwsAccountsDAO) => dao.setAccountNickname('123456789012', 'prod')],
      ['removeAccountNickname', (dao: AwsAccountsDAO) => dao.removeAccountNickname('123456789012')],
      ['deleteOrphaned', (dao: AwsAccountsDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new AwsAccountsDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('RoleConfigsDAO', () => {
    it.each([
      ['setRoleConfig', (dao: RoleConfigsDAO) => dao.setRoleConfig('123456789012', 'Dev')],
      ['deleteRoleConfig', (dao: RoleConfigsDAO) => dao.deleteRoleConfig('123456789012', 'Dev')],
      ['deleteOrphaned', (dao: RoleConfigsDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new RoleConfigsDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('TeamAccountsDAO', () => {
    it.each([
      ['addAccountToTeam', (dao: TeamAccountsDAO) => dao.addAccountToTeam('t1', '123456789012')],
      ['removeAccountFromTeam', (dao: TeamAccountsDAO) => dao.removeAccountFromTeam('t1', '123456789012')],
      ['deleteOrphaned', (dao: TeamAccountsDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new TeamAccountsDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('CostDataDAO', () => {
    it.each([
      [
        'upsertCostData',
        (dao: CostDataDAO) =>
          dao.upsertCostData({
            awsAccountId: '123456789012',
            periodStart: '2025-01-01',
            periodEnd: '2025-01-02',
            totalCost: 1,
            currency: 'USD',
            serviceBreakdown: {},
            collectedAt: 1,
          }),
      ],
      ['deleteOrphaned', (dao: CostDataDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new CostDataDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('ResourceInventoryDAO', () => {
    const ITEM = {
      awsAccountId: '123456789012',
      region: 'us-east-1',
      resourceType: 'ec2',
      resourceId: 'i-1',
      resourceName: 'web',
      state: 'running',
      metadata: {},
      collectedAt: 1,
    };

    it.each([
      ['upsertResource', (dao: ResourceInventoryDAO) => dao.upsertResource(ITEM)],
      ['deleteStaleResources', (dao: ResourceInventoryDAO) => dao.deleteStaleResources('123456789012', 'ec2', 100)],
      ['deleteOrphaned', (dao: ResourceInventoryDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new ResourceInventoryDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('SpendAlertDAO', () => {
    it.each([
      ['createAlert', (dao: SpendAlertDAO) => dao.createAlert('123456789012', 10, 'MONTHLY', 'user@example.com')],
      ['deleteAlert', (dao: SpendAlertDAO) => dao.deleteAlert('alert-1')],
      ['deleteOrphaned', (dao: SpendAlertDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new SpendAlertDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('DataCollectionConfigDAO', () => {
    it.each([
      ['create', (dao: DataCollectionConfigDAO) => dao.create('arn:aws:iam::123456789012:role/Dev', 'cost')],
      ['delete', (dao: DataCollectionConfigDAO) => dao.delete('arn:aws:iam::123456789012:role/Dev', 'cost')],
      ['updateLastCollectedTime', (dao: DataCollectionConfigDAO) => dao.updateLastCollectedTime('arn:aws:iam::123456789012:role/Dev', 'cost')],
      ['deleteOrphaned', (dao: DataCollectionConfigDAO) => dao.deleteOrphaned()],
    ])('%s throws DatabaseError', async (_name, call) => {
      const { stmt } = failingStatement();
      await expect(call(new DataCollectionConfigDAO(dbWith(stmt) as never))).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('TeamsDAO', () => {
    it('createTeam throws instead of returning a teamId that resolves to nothing', async () => {
      // `teams.team_name` is UNIQUE, so a duplicate name is the realistic failure.
      const { stmt } = failingStatement();
      await expect(new TeamsDAO(dbWith(stmt) as never).createTeam('existing', 'user@example.com')).rejects.toBeInstanceOf(DatabaseError);
    });

    it('updateTeamName throws on a constraint violation', async () => {
      const { stmt } = failingStatement();
      await expect(new TeamsDAO(dbWith(stmt) as never).updateTeamName('t1', 'taken')).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('TeamMembersDAO', () => {
    it.each([
      ['addMember', (dao: TeamMembersDAO) => dao.addMember('t1', OWNER)],
      ['removeMember', (dao: TeamMembersDAO) => dao.removeMember('t1', OWNER)],
      ['updateMemberRole', (dao: TeamMembersDAO) => dao.updateMemberRole('t1', OWNER, 'admin')],
    ])('%s throws DatabaseError, not a bare Error', async (_name, call) => {
      const { stmt } = failingStatement();
      const thrown = await call(new TeamMembersDAO(dbWith(stmt) as never)).catch((error: unknown) => error);
      // A bare `Error` bypasses the `IServiceError` taxonomy, so `toErrorResponse`
      // answers it with a generic 500 and drops the database detail entirely.
      expect(thrown).toBeInstanceOf(DatabaseError);
    });
  });

  describe('AuditLogDAO', () => {
    it('deleteOlderThanBatch throws rather than reporting 0 rows', async () => {
      // `AbstractPruningTask` reads the returned count to decide whether to loop,
      // so a silent 0 made retention exit as a success while nothing was pruned.
      const { stmt } = failingStatement();
      await expect(new AuditLogDAO(dbWith(stmt) as never).deleteOlderThanBatch(100, 50)).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('CredentialsDAO', () => {
    it('storeCredential throws on failure', async () => {
      const { stmt } = failingStatement();
      // A real 256-bit key: `storeCredential` encrypts before it writes, and a
      // malformed key would fail there instead of at the statement under test.
      const key = btoa(String.fromCharCode(...new Uint8Array(32)));
      await expect(new CredentialsDAO(dbWith(stmt) as never, [key], 3).storeCredential('arn:aws:iam::123456789012:role/Dev', 'AKIA', 'secret')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  describe('retry classification', () => {
    it('marks a busy/locked database retryable and a constraint violation not', async () => {
      const build = (error: string): D1Database => {
        const stmt = { bind: vi.fn(), run: vi.fn().mockResolvedValue({ success: false, error } as unknown as D1Result) };
        stmt.bind.mockReturnValue(stmt);
        return dbWith(stmt);
      };

      const busy = await new AwsAccountsDAO(build('SQLITE_BUSY: database is locked') as never)
        .ensureAccountExists('123456789012')
        .catch((error: unknown) => error as DatabaseError);
      expect(busy.retryable).toBe(true);

      const constraint = await new AwsAccountsDAO(build('UNIQUE constraint failed: teams.team_name') as never)
        .ensureAccountExists('123456789012')
        .catch((error: unknown) => error as DatabaseError);
      expect(constraint.retryable).toBe(false);
    });
  });
});