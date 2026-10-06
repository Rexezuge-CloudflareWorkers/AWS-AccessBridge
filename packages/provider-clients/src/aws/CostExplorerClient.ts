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

interface CostExplorerGetCostAndUsageResponse {
  ResultsByTime?: CostExplorerTimeResult[];
  /**
   * Continuation cursor. Present only while more pages remain.
   */
  NextPageToken?: string;
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

  /**
   * `GetCostAndUsage` returns a partial result when the account's service
   * breakdown exceeds one page, signalled by `NextPageToken`.
   *
   * **This is followed to exhaustion, and the omission was a spend bug rather
   * than a cosmetic one.** `CostService`'s totals, and therefore every spend
   * alert, are computed from these groups. A truncated page reported a spend
   * figure *below* the account's actual spend, so an alert set near the real
   * threshold could be missed indefinitely — and the shortfall is invisible,
   * because a partial page is a well-formed response that looks complete.
   */
  public async getCostAndUsage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY' = 'DAILY',
    region = 'us-east-1',
  ): Promise<CostExplorerResult[]> {
    const periods = new Map<string, AccumulatedPeriod>();
    const seenTokens = new Set<string>();
    let nextPageToken: string | undefined;

    for (;;) {
      const page: CostExplorerGetCostAndUsageResponse = await this.getCostAndUsagePage(accessKeys, startDate, endDate, granularity, region, nextPageToken);
      const timeResults: CostExplorerTimeResult[] = page.ResultsByTime ?? [];
      for (const result of timeResults) {
        this.accumulatePeriod(periods, result, startDate, endDate);
      }

      const token: string | undefined = page.NextPageToken;
      if (!token) {
        break;
      }
      // Same non-advancing guard as the resource collectors: a repeated token
      // would otherwise re-fetch the same page until the request's wall-clock
      // limit. Truncating loudly is better than hanging.
      if (seenTokens.has(token)) {
        console.error('Cost Explorer repeated a NextPageToken; returning a partial cost breakdown.');
        break;
      }
      seenTokens.add(token);
      nextPageToken = token;
    }

    return Array.from(periods.values(), (period) => ({
      accountId: '',
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      totalCost: MoneyUtil.round(period.totalCost),
      currency: period.currency,
      serviceBreakdown: period.serviceBreakdown,
    }));
  }

  /**
   * Fold one period's groups into the running accumulator.
   *
   * **Accumulated across pages, keyed by period.** `GetCostAndUsage` can split a
   * single period's service groups over several pages, so the same period may
   * arrive more than once. Emitting one result per arrival would not merely
   * double-count: `CostDataDAO.upsertCostData` keys on `(account, period_start)`
   * with `INSERT OR REPLACE`, so the later page would silently *replace* the
   * earlier one and the stored period would carry only the last page's cost —
   * under-reporting spend while still looking like a complete record.
   */
  private accumulatePeriod(periods: Map<string, AccumulatedPeriod>, result: CostExplorerTimeResult, startDate: string, endDate: string): void {
    const periodStart: string = result.TimePeriod?.Start ?? startDate;
    const periodEnd: string = result.TimePeriod?.End ?? endDate;
    const key: string = `${periodStart}|${periodEnd}`;

    let period: AccumulatedPeriod | undefined = periods.get(key);
    if (!period) {
      period = { currency: 'USD', periodEnd, periodStart, serviceBreakdown: {}, totalCost: 0 };
      periods.set(key, period);
    }

    const groups: CostExplorerGroup[] = result.Groups ?? [];
    for (const group of groups) {
      const unit: string | undefined = group.Metrics?.UnblendedCost?.Unit;
      if (unit) {
        period.currency = unit;
      }
      const amount: number = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      if (amount <= 0) {
        continue;
      }
      const serviceName: string = group.Keys?.[0] ?? 'Unknown';
      period.serviceBreakdown[serviceName] = (period.serviceBreakdown[serviceName] ?? 0) + amount;
      period.totalCost += amount;
    }
  }

  private async getCostAndUsagePage(
    accessKeys: AccessKeys,
    startDate: string,
    endDate: string,
    granularity: 'DAILY' | 'MONTHLY',
    region: string,
    nextPageToken: string | undefined,
  ): Promise<CostExplorerGetCostAndUsageResponse> {
    const client = this.clientFactory({ service: 'ce', region, keys: accessKeys });

    const body = JSON.stringify({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: granularity,
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      ...(nextPageToken && { NextPageToken: nextPageToken }),
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

    try {
      return JSON.parse(responseText) as CostExplorerGetCostAndUsageResponse;
    } catch (error: unknown) {
      // A malformed body would otherwise throw a raw `SyntaxError`, bypassing the
      // `IServiceError` taxonomy and the typed 4xx/5xx mapping the callers rely on.
      throw new InternalServerError(`Cost Explorer returned a malformed response body: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private toResults(data: CostExplorerGetCostAndUsageResponse, startDate: string, endDate: string): CostExplorerResult[] {
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

/**
 * A period's running total, accumulated across however many pages it spans.
 */
interface AccumulatedPeriod {
  periodStart: string;
  periodEnd: string;
  currency: string;
  totalCost: number;
  serviceBreakdown: Record<string, number>;
}

export { CostExplorerClient };
export type { AccumulatedPeriod, CostExplorerGetCostAndUsageResponse, CostExplorerGroup, CostExplorerResult, CostExplorerTimeResult };
