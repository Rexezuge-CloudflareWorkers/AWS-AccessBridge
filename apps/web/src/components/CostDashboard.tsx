'use client';

import { useState, useEffect } from 'react';
import Spinner from './ui/Spinner';

interface CostSummary {
  accounts: Record<string, { totalCost: number; currency: string }>;
  grandTotal: number;
}

interface TrendMonth {
  period: string;
  total: number;
  byAccount: Record<string, number>;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatMonthLabel(period: string): string {
  const monthNum = parseInt(period.substring(5, 7), 10);
  return MONTH_NAMES[monthNum - 1] ?? period.substring(5);
}

export default function CostDashboard() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [trends, setTrends] = useState<TrendMonth[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [summaryRes, trendsRes] = await Promise.all([fetch('/api/cost/summary'), fetch('/api/cost/trends?months=6')]);

        if (summaryRes.ok) {
          setSummary((await summaryRes.json()) as CostSummary);
        }
        if (trendsRes.ok) {
          const trendsData = (await trendsRes.json()) as { months: TrendMonth[] };
          setTrends(trendsData.months || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load cost data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  if (isLoading) {
    return <Spinner size={40} label="Loading cost data..." padding="48px 0" />;
  }

  if (error) {
    return (
      <div style={{ background: 'rgba(127, 29, 29, 0.3)', color: '#fca5a5', padding: '12px 16px', borderRadius: '12px' }}>{error}</div>
    );
  }

  const maxTrend: number = trends.length > 0 ? Math.max(...trends.map((t) => t.total), 1) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>Total Spend (30d)</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>${summary?.grandTotal?.toFixed(2) || '0.00'}</p>
        </div>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>Accounts Tracked</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>{Object.keys(summary?.accounts || {}).length}</p>
        </div>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>Months of Data</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>{trends.length}</p>
        </div>
      </div>

      {/* Trend Chart */}
      {trends.length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#e5e7eb' }}>Monthly Cost Trends</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '192px' }}>
            {trends.map((month) => (
              <div key={month.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>${month.total.toFixed(0)}</span>
                <div
                  style={{
                    width: '100%',
                    background: 'linear-gradient(to top, #2563eb, #60a5fa)',
                    borderRadius: '4px 4px 0 0',
                    height: `${(month.total / maxTrend) * 100}%`,
                    minHeight: month.total > 0 ? '4px' : '0',
                    transition: 'all 0.2s',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>{formatMonthLabel(month.period)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Account Breakdown */}
      {summary && Object.keys(summary.accounts).length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#e5e7eb' }}>Account Breakdown</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(summary.accounts)
              .sort(([, a], [, b]) => b.totalCost - a.totalCost)
              .map(([accountId, data]) => (
                <div
                  key={accountId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: '#252d3d',
                    borderRadius: '8px',
                  }}
                >
                  <span className="font-mono" style={{ fontSize: '14px', color: '#d1d5db' }}>
                    {accountId}
                  </span>
                  <span style={{ fontWeight: 600, color: '#fff' }}>
                    ${data.totalCost.toFixed(2)} {data.currency}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {!summary || Object.keys(summary.accounts).length === 0 ? (
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
          <svg
            style={{ width: '48px', height: '48px', color: '#4b5563', margin: '0 auto 16px' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p style={{ fontSize: '18px', color: '#d1d5db', marginBottom: '8px' }}>No cost data available yet.</p>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            Enable data collection for your accounts in the Admin panel to start tracking costs.
          </p>
        </div>
      ) : null}
    </div>
  );
}
