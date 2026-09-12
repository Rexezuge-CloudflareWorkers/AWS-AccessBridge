interface ResourceInventoryItem {
  awsAccountId: string;
  region: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  metadata: Record<string, string>;
  collectedAt: number;
}

interface ResourceInventoryItemInternal {
  aws_account_id: string;
  region: string;
  resource_type: string;
  resource_id: string;
  resource_name: string;
  state: string;
  metadata: string;
  collected_at: number;
}

export type { ResourceInventoryItem, ResourceInventoryItemInternal };
