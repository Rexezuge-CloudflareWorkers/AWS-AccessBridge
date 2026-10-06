import { apiRequest } from '../lib/api';

interface CostSummary {
  accounts: Record<string, { totalCost: number; currency: string }>;
  grandTotal: number;
  /**
 * Null when the accounts do not all report the same currency.
 */
  currency: string | null;
}

interface TrendMonth {
  period: string;
  total: number;
  byAccount: Record<string, number>;
}

async function loadSummary(): Promise<CostSummary> {
  return apiRequest<CostSummary>('/user/costs/summary');
}

async function loadTrends(months = 6): Promise<TrendMonth[]> {
  const trendsData = await apiRequest<{ months: TrendMonth[] }>(`/user/costs/trends?months=${months}`);
  return trendsData.months || [];
}

export type { CostSummary, TrendMonth };
export { loadSummary, loadTrends };
