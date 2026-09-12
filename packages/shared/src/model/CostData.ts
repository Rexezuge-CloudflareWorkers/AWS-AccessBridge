interface CostData {
  awsAccountId: string;
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  currency: string;
  serviceBreakdown: Record<string, number>;
  collectedAt: number;
}

interface CostDataInternal {
  aws_account_id: string;
  period_start: string;
  period_end: string;
  total_cost: number;
  currency: string;
  service_breakdown: string;
  collected_at: number;
}

export type { CostData, CostDataInternal };
