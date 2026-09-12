import { readJson, throwForResponse } from '../lib/api';

interface CostSummary {
  accounts: Record<string, { totalCost: number; currency: string }>;
  grandTotal: number;
}

interface TrendMonth {
  period: string;
  total: number;
  byAccount: Record<string, number>;
}

async function loadSummary(): Promise<CostSummary> {
  const summaryRes = await fetch('/user/costs/summary');
  if (!summaryRes.ok) {
    await throwForResponse(summaryRes, 'Failed to load cost summary');
  }
  return readJson<CostSummary>(summaryRes);
}

async function loadTrends(months = 6): Promise<TrendMonth[]> {
  const trendsRes = await fetch(`/user/costs/trends?months=${months}`);
  if (!trendsRes.ok) {
    await throwForResponse(trendsRes, 'Failed to load cost trends');
  }
  const trendsData = await readJson<{ months: TrendMonth[] }>(trendsRes);
  return trendsData.months || [];
}

export type { CostSummary, TrendMonth };
export { loadSummary, loadTrends };
