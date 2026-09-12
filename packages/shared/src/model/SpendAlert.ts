interface SpendAlert {
  alertId: string;
  awsAccountId: string;
  thresholdAmount: number;
  currency: string;
  periodType: string;
  createdBy: string;
  createdAt: number;
  enabled: boolean;
}

interface SpendAlertInternal {
  alert_id: string;
  aws_account_id: string;
  threshold_amount: number;
  currency: string;
  period_type: string;
  created_by: string;
  created_at: number;
  enabled: number;
}

export type { SpendAlert, SpendAlertInternal };
