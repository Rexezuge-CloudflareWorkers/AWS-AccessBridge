import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostService } from '@aws-access-bridge/backend-services/cost/CostService';
import { AssumableRolesDAO } from '@aws-access-bridge/backend-data/dao/AssumableRolesDAO';
import { CostDataDAO } from '@aws-access-bridge/backend-data/dao/CostDataDAO';
import { UserEmailDAO } from '@aws-access-bridge/backend-data/dao/UserEmailDAO';

vi.mock('@aws-access-bridge/backend-data/dao/AssumableRolesDAO');
vi.mock('@aws-access-bridge/backend-data/dao/CostDataDAO');
// Migration 0032: the identity lookup consults the address registry first, so an
// unstubbed one must read as "no registry row" and fall through to the anchor.
vi.mock('@aws-access-bridge/backend-data/dao/UserEmailDAO');

function db(): never {
  const chain = { bind: () => chain, run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) };
  return { prepare: () => chain } as never;
}

const ENV = { AccessBridgeDB: db() } as never;

function service(): CostService {
  vi.mocked(UserEmailDAO.prototype.get).mockResolvedValue(null);
  return new CostService(ENV);
}

interface CostRow {
  awsAccountId: string;
  currency: string;
  totalCost: number;
  [key: string]: unknown;
}

function row(awsAccountId: string, totalCost: number, currency = 'USD'): CostRow {
  return { awsAccountId, currency, totalCost };
}

describe('CostService.getSummary currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AssumableRolesDAO.prototype.getDistinctAccountIds).mockResolvedValue(['111111111111', '222222222222']);
  });

  it('reports the shared currency when every account agrees', async () => {
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([row('111111111111', 1542.37), row('222222222222', 823.15)]);

    const summary = await service().getSummary('user@example.com');

    expect(summary.currency).toBe('USD');
    expect(summary.grandTotal).toBe(2365.52);
  });

  it('reports no currency when accounts disagree', async () => {
    // Regression guard: the summary total is a plain sum across accounts, so a
    // currency declared from the first row alone would label a USD+EUR sum as
    // either one of them. `null` is the honest answer, and the client renders a
    // visibly-incomplete figure rather than a confident wrong symbol.
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([row('111111111111', 1542.37, 'USD'), row('222222222222', 823.15, 'EUR')]);

    const summary = await service().getSummary('user@example.com');

    expect(summary.currency).toBeNull();
    // The per-account currencies are still exact, so the breakdown stays usable.
    expect(summary.accounts['111111111111'].currency).toBe('USD');
    expect(summary.accounts['222222222222'].currency).toBe('EUR');
  });

  it('reports no currency when the disagreement appears late in the data', async () => {
    // Guards against a short-circuit that stops checking once it has decided.
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([row('111111111111', 1, 'USD'), row('222222222222', 1, 'USD'), row('333333333333', 1, 'JPY')]);

    const summary = await service().getSummary('user@example.com');

    expect(summary.currency).toBeNull();
  });

  it('reports no currency when the disagreement is only visible on a later row of one account', async () => {
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([row('111111111111', 1, 'USD'), row('111111111111', 2, 'GBP')]);

    const summary = await service().getSummary('user@example.com');

    expect(summary.currency).toBeNull();
  });

  it('reports no currency for an empty summary', async () => {
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([]);

    const summary = await service().getSummary('user@example.com');

    expect(summary).toEqual({ accounts: {}, grandTotal: 0, currency: null });
  });

  it('still rounds the total and per-account costs', async () => {
    vi.mocked(CostDataDAO.prototype.getCostDataForAccounts).mockResolvedValue([row('111111111111', 0.1), row('111111111111', 0.2)]);

    const summary = await service().getSummary('user@example.com');

    expect(summary.accounts['111111111111'].totalCost).toBe(0.3);
    expect(summary.grandTotal).toBe(0.3);
    expect(summary.currency).toBe('USD');
  });
});