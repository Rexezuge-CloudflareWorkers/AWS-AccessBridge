import { AssumableRolesDAO, CostDataDAO, DataCollectionConfigDAO, SpendAlertDAO } from '@aws-access-bridge/backend-data/dao';
import type { AssumableRoleOwner } from '@aws-access-bridge/backend-data/dao';

import type { CostData, SpendAlert } from '@aws-access-bridge/shared/model';
import { BadRequestError, ForbiddenError } from '@aws-access-bridge/backend-errors';
import { MoneyUtil } from '@aws-access-bridge/shared/utils/MoneyUtil';
import type { ServiceEnv } from '../composition/ServiceEnv';
import { UserIdentityService } from '../identity/UserIdentityService';
import { resolveOwner } from '../identity/resolveOwner';

type CostServiceEnv = ServiceEnv;

/**
The window used when a caller does not supply one, matching the cron default.
*/
const DEFAULT_COST_LOOKBACK_DAYS: number = 30;

/**
Cost Explorer's granularity cannot express a calendar month, so trends use 30-day months.
*/
const DAYS_PER_MONTH: number = 30;

interface AccountCostSummary {
  totalCost: number;
  currency: string;
}

interface CostSummary {
  accounts: Record<string, AccountCostSummary>;
  grandTotal: number;
  /**
   * The currency `grandTotal` is denominated in. The total is a plain sum across
   * accounts, so it only has a currency if they agree; when they do not, this is
   * `null` and the client must not render a symbol, because a `$` on a mixed-EUR
   * sum would be a confident wrong answer rather than an obvious omission.
   */
  currency: string | null;
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
  private readonly identity: UserIdentityService;

  constructor(
    private readonly env: CostServiceEnv,
    identity?: UserIdentityService,
  ) {
    this.identity = identity ?? new UserIdentityService(env);
  }


  private ownerFor(userEmail: string): Promise<AssumableRoleOwner> {
    return resolveOwner(this.identity, userEmail);
  }

  public async getSummary(userEmail: string, lookbackDays: number = 30): Promise<CostSummary> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(await this.ownerFor(userEmail));

    if (accountIds.length === 0) return { accounts: {}, grandTotal: 0, currency: null };

    const { startDate, endDate } = MoneyUtil.lookbackWindow(lookbackDays);

    const costDataDAO: CostDataDAO = new CostDataDAO(this.env.AccessBridgeDB);
    const costData: CostData[] = await costDataDAO.getCostDataForAccounts(accountIds, startDate, endDate);

    const accounts: Record<string, AccountCostSummary> = {};
    let grandTotal: number = 0;
    let summaryCurrency: string | null = null;

    for (const data of costData) {
      if (accounts[data.awsAccountId] === undefined) {
        accounts[data.awsAccountId] = { totalCost: 0, currency: data.currency };
      }
      accounts[data.awsAccountId].totalCost += data.totalCost;
      grandTotal += data.totalCost;
      // Track agreement rather than taking the first account's currency: a
      // sum that silently spans USD and EUR is arithmetically meaningless, and
      // the honest answer is to report no currency at all.
      if (summaryCurrency === null) {
        summaryCurrency = data.currency;
      } else if (summaryCurrency !== data.currency) {
        summaryCurrency = null;
      }
    }

    for (const accountId in accounts) {
      accounts[accountId].totalCost = MoneyUtil.round(accounts[accountId].totalCost);
    }

    return { accounts, grandTotal: MoneyUtil.round(grandTotal), currency: summaryCurrency };
  }

  public async getAccountCost(userEmail: string, awsAccountId: string, startDate?: string, endDate?: string): Promise<AccountCost> {
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const roles: string[] = await assumableRolesDAO.getRolesByUserAndAccount(await this.ownerFor(userEmail), awsAccountId);
    if (roles.length === 0) throw new ForbiddenError('You do not have access to this account.');

    const { startDate: defaultStart, endDate: defaultEnd } = MoneyUtil.lookbackWindow(DEFAULT_COST_LOOKBACK_DAYS);
    const effectiveEndDate: string = endDate || defaultEnd;
    const effectiveStartDate: string = startDate || defaultStart;

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
      total: MoneyUtil.round(total),
    };
  }

  public async getTrends(userEmail: string, months: number = 6): Promise<{ months: MonthlyTrend[] }> {
    const boundedMonths: number = Math.min(months, 12);
    const assumableRolesDAO: AssumableRolesDAO = new AssumableRolesDAO(this.env.AccessBridgeDB);
    const accountIds: string[] = await assumableRolesDAO.getDistinctAccountIds(await this.ownerFor(userEmail));

    if (accountIds.length === 0) return { months: [] };

    // A month is 30 days here because Cost Explorer's granularity cannot express a
    // calendar month; the previous code hardcoded the same `* 30`.
const { startDate, endDate } = MoneyUtil.lookbackWindow(boundedMonths * DAYS_PER_MONTH);

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
        total: MoneyUtil.round(data.total),
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
}export { CostService };
export type { AccountCost, AccountCostSummary, CostServiceEnv, CostSummary, MonthlyTrend };
