import { AssumableRolesDAO, CostDataDAO, DataCollectionConfigDAO, SpendAlertDAO } from '@aws-access-bridge/backend-data/dao';
import type { D1Queryable } from '@aws-access-bridge/backend-data/utils';
import type { CostData, SpendAlert } from '@aws-access-bridge/shared/model';
import { BadRequestError, ForbiddenError } from '@aws-access-bridge/backend-errors';

interface CostServiceEnv {
  AccessBridgeDB: D1Queryable;
}

interface AccountCostSummary {
  totalCost: number;
  currency: string;
}

interface CostSummary {
  accounts: Record<string, AccountCostSummary>;
  grandTotal: number;
}

interface AccountCost {
  awsAccountId: string;
  dailyCosts: CostData[];
  serviceBreakdown: Record<string, number>;
  total: number;
}

interface MonthlyTrend {
  period: string;
  total: number;
  byAccount: Record<string, number>;
}

class CostService {
  constructor(private readonly env: CostServiceEnv) {}

  public async getSummary(userEmail: string, lookbackDays: number = 30): Promise<CostSummary> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    if (accountIds.length === 0) return { accounts: {}, grandTotal: 0 };

    const endDate: string = new Date().toISOString().split('T', 1)[0];
    const startDate: string = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().split('T', 1)[0];

    const costDataDAO: CostDataDAO = new CostDataDAO(this.env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataForAccounts(accountIds, startDate, endDate);

    const accounts: Record<string, AccountCostSummary> = {};
    let grandTotal: number = 0;

    for (const data of costData) {
      if (accounts[data.awsAccountId] === undefined) {
        accounts[data.awsAccountId] = { totalCost: 0, currency: data.currency };
      }
      accounts[data.awsAccountId].totalCost += data.totalCost;
      grandTotal += data.totalCost;
    }

    // Round totals
    for (const accountId in accounts) {
      accounts[accountId].totalCost = Math.round(accounts[accountId].totalCost * 100) / 100;
    }

    return { accounts, grandTotal: Math.round(grandTotal * 100) / 100 };
  }

  public async getAccountCost(userEmail: string, awsAccountId: string, startDate?: string, endDate?: string): Promise<AccountCost> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const roles: string[] = await assumableRolesDAO.getRolesByUserAndAccount(userEmail, awsAccountId);
    if (roles.length === 0) throw new ForbiddenError('You do not have access to this account.');

    const effectiveEndDate: string = endDate || new Date().toISOString().split('T', 1)[0];
    const effectiveStartDate: string = startDate || new Date(Date.now() - 30 * 86_400_000).toISOString().split('T', 1)[0];

    const costDataDAO: CostDataDAO = new CostDataDAO(this.env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataByAccount(awsAccountId, effectiveStartDate, effectiveEndDate);

    let total: number = 0;
    const serviceBreakdown: Record<string, number> = {};
    for (const data of costData) {
      total += data.totalCost;
      for (const [service, amount] of Object.entries(data.serviceBreakdown)) {
        serviceBreakdown[service] = (serviceBreakdown[service] || 0) + amount;
      }
    }

    return {
      awsAccountId,
      dailyCosts: costData,
      serviceBreakdown,
      total: Math.round(total * 100) / 100,
    };
  }

  public async getTrends(userEmail: string, months: number = 6): Promise<{ months: MonthlyTrend[] }> {
    const boundedMonths: number = Math.min(months, 12);
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(userEmail);

    if (accountIds.length === 0) return { months: [] };

    const endDate: string = new Date().toISOString().split('T', 1)[0];
    const startDate: string = new Date(Date.now() - boundedMonths * 30 * 86_400_000).toISOString().split('T', 1)[0];

    const costDataDAO: CostDataDAO = new CostDataDAO(this.env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataForAccounts(accountIds, startDate, endDate);

    // Aggregate by month
    const monthlyData: Record<string, { total: number; byAccount: Record<string, number> }> = {};
    for (const data of costData) {
      const month: string = data.periodStart.slice(0, 7); // YYYY-MM
      if (monthlyData[month] === undefined) monthlyData[month] = { total: 0, byAccount: {} };
      monthlyData[month].total += data.totalCost;
      monthlyData[month].byAccount[data.awsAccountId] = (monthlyData[month].byAccount[data.awsAccountId] || 0) + data.totalCost;
    }

    const result = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({
        period,
        total: Math.round(data.total * 100) / 100,
        byAccount: data.byAccount,
      }));

    return { months: result };
  }

  public async createAlert(awsAccountId: string, thresholdAmount: number, periodType: string, createdBy: string): Promise<SpendAlert> {
    if (!awsAccountId || !thresholdAmount) {
      throw new BadRequestError('Missing required fields: awsAccountId and thresholdAmount.');
    }
    const spendAlertDAO: SpendAlertDAO = new SpendAlertDAO(this.env.AccessBridgeDB);
    return spendAlertDAO.createAlert(awsAccountId, thresholdAmount, periodType || 'monthly', createdBy);
  }

  public async deleteAlert(alertId: string): Promise<void> {
    if (!alertId) throw new BadRequestError('Missing required field: alertId.');
    const spendAlertDAO: SpendAlertDAO = new SpendAlertDAO(this.env.AccessBridgeDB);
    await spendAlertDAO.deleteAlert(alertId);
  }

  public async enableCollection(principalArn: string, collectionTypes: string[]): Promise<void> {
    if (!principalArn || !collectionTypes?.length) {
      throw new BadRequestError('Missing required fields: principalArn and collectionTypes.');
    }
    const dao: DataCollectionConfigDAO = new DataCollectionConfigDAO(this.env.AccessBridgeDB);
    for (const type of collectionTypes) {
      await dao.create(principalArn, type);
    }
  }

  public async disableCollection(principalArn: string, collectionType: string): Promise<void> {
    if (!principalArn || !collectionType) {
      throw new BadRequestError('Missing required fields: principalArn and collectionType.');
    }
    const dao: DataCollectionConfigDAO = new DataCollectionConfigDAO(this.env.AccessBridgeDB);
    await dao.delete(principalArn, collectionType);
  }
}

class CostServiceFactory {
  public static create(env: CostServiceEnv): CostService {
    return new CostService(env);
  }
}

export { CostService, CostServiceFactory };
export type { AccountCost, AccountCostSummary, CostServiceEnv, CostSummary, MonthlyTrend };
