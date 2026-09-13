import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { CostExplorerClient, defaultAwsClientFactory } from '@aws-access-bridge/provider-clients/aws';
import type { AwsClientFactory, CostExplorerResult } from '@aws-access-bridge/provider-clients/aws';

/**
 * Domain Cost Explorer service (Layer 3). Delegates raw signed-fetch +
 * JSON parsing to `provider-clients` `CostExplorerClient` (Layer 2).
 */
class CostExplorerService {
  private readonly client: CostExplorerClient;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.client = new CostExplorerClient(clientFactory);
  }

  public async getCostAndUsage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'DAILY',
    region = 'us-east-1',
  ): Promise<CostExplorerResult[]> {
    return this.client.getCostAndUsage(accessKeys, startDate, endDate, granularity, region);
  }
}

export { CostExplorerService };


export {type CostExplorerResult} from '@aws-access-bridge/provider-clients/aws';