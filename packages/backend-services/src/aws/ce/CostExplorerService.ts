import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';

interface CostExplorerResult {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  currency: string;
  serviceBreakdown: Record<string, number>;
}

class CostExplorerService {
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async getCostAndUsage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'DAILY',
    region: string = 'us-east-1',
  ): Promise<CostExplorerResult[]> {
    const client = this.clientFactory({ service: 'ce', region, keys: accessKeys });

    const body = JSON.stringify({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: granularity,
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    const response: Response = await client.fetch(`https://ce.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSInsightsIndexService.GetCostAndUsage',
      },
      body,
    });

    const responseText: string = await response.text();

    if (!response.ok) {
      console.error(`Cost Explorer API failed: ${response.status}\n${responseText}`);
      throw new InternalServerError(`Cost Explorer API failed: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = JSON.parse(responseText);
    const results: CostExplorerResult[] = [];
    const resultsByTime: any[] = data.ResultsByTime || [];

    for (const result of resultsByTime) {
      const serviceBreakdown: Record<string, number> = {};
      let totalCost: number = 0;
      let currency: string = 'USD';
      const groups: any[] = result.Groups || [];

      for (const group of groups) {
        const serviceName: string = group.Keys?.[0] || 'Unknown';
        const amount: number = Number(group.Metrics?.UnblendedCost?.Amount || '0');
        currency = group.Metrics?.UnblendedCost?.Unit || 'USD';
        if (amount > 0) {
          serviceBreakdown[serviceName] = amount;
          totalCost += amount;
        }
      }

      results.push({
        accountId: '',
        periodStart: result.TimePeriod?.Start || startDate,
        periodEnd: result.TimePeriod?.End || endDate,
        totalCost: Math.round(totalCost * 100) / 100,
        currency,
        serviceBreakdown,
      });
    }

    return results;
  }
}

export { CostExplorerService };
export type { CostExplorerResult };
