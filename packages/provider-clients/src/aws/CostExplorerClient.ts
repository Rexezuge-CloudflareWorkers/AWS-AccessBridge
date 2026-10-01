import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { MoneyUtil } from '@aws-access-bridge/shared/utils/MoneyUtil';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import type { AwsClientFactory } from './AwsSignedFetcher';
import { defaultAwsClientFactory } from './AwsSignedFetcher';

interface CostExplorerResult {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  currency: string;
  serviceBreakdown: Record<string, number>;
}

interface CostExplorerGroup {
  Keys?: string[];
  Metrics?: { UnblendedCost?: { Amount?: string; Unit?: string } };
}

interface CostExplorerTimeResult {
  TimePeriod?: { Start?: string; End?: string };
  Groups?: CostExplorerGroup[];
}

/**
 * Raw AWS Cost Explorer client (Layer 2). Owns signed-fetch + JSON parsing.
 * Aggregation semantics preserved from `backend-services` predecessor.
 */
class CostExplorerClient {
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async getCostAndUsage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'DAILY',
    region = 'us-east-1',
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

    let data: { ResultsByTime?: CostExplorerTimeResult[] };
    try {
      data = JSON.parse(responseText) as { ResultsByTime?: CostExplorerTimeResult[] };
    } catch (error: unknown) {
      // A malformed body would otherwise throw a raw `SyntaxError`, bypassing the
      // `IServiceError` taxonomy and the typed 4xx/5xx mapping the callers rely on.
      throw new InternalServerError(`Cost Explorer returned a malformed response body: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const results: CostExplorerResult[] = [];
    const resultsByTime: CostExplorerTimeResult[] = data.ResultsByTime ?? [];

    for (const result of resultsByTime) {
      const serviceBreakdown: Record<string, number> = {};
      let totalCost = 0;
      let currency = 'USD';
      const groups: CostExplorerGroup[] = result.Groups ?? [];

      for (const group of groups) {
        const serviceName: string = group.Keys?.[0] ?? 'Unknown';
        const amount: number = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
        currency = group.Metrics?.UnblendedCost?.Unit ?? 'USD';
        if (amount <= 0) {
          continue;
        }
        serviceBreakdown[serviceName] = amount;
        totalCost += amount;
      }

      results.push({
        accountId: '',
        periodStart: result.TimePeriod?.Start ?? startDate,
        periodEnd: result.TimePeriod?.End ?? endDate,
        totalCost: MoneyUtil.round(totalCost),
        currency,
        serviceBreakdown,
      });
    }

    return results;
  }
}

export { CostExplorerClient };
export type { CostExplorerGroup, CostExplorerResult, CostExplorerTimeResult };
