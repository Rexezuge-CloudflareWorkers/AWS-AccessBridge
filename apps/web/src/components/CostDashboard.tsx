'use client';

import { useTranslation } from 'react-i18next';
import Spinner from './ui/Spinner';
import { formatAmount, formatCurrency, formatMonthLabel } from '../lib/format';
import { maxTrend, sortAccountsByCost, trendBarPercent } from '../lib/costTrends';
import { useResource } from '../hooks/useResource';
import { loadSummary, loadTrends } from '../services/costService';
import type { TrendMonth } from '../services/costService';

// Module-level, so the fetcher keeps one identity and the data loads once.
const loadCostData = () => Promise.all([loadSummary(), loadTrends()]);
const NO_TRENDS: TrendMonth[] = [];

export default function CostDashboard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? 'en';
  const { data, error, isLoading } = useResource(loadCostData, {
    errorFallback: t('costs.loadError', 'Failed to load cost data'),
    reloadOnUnauthorized: true,
  });
  if (isLoading) {
    return <Spinner size={40} label={t('costs.loading', 'Loading cost data...')} padding="48px 0" />;
  }

  if (error) {
    return (
      <div style={{ background: 'rgba(127, 29, 29, 0.3)', color: '#fca5a5', padding: '12px 16px', borderRadius: '12px' }}>{error}</div>
    );
  }

  const summary = data?.[0] ?? null;
  const trends = data?.[1] ?? NO_TRENDS;
  const maxTotal = maxTrend(trends);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>{t('costs.totalSpend', 'Total Spend (30d)')}</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>
            {formatAmount(summary?.grandTotal ?? 0, summary?.currency ?? null, lng)}
          </p>
        </div>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>{t('costs.accountsTracked', 'Accounts Tracked')}</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>{Object.keys(summary?.accounts || {}).length}</p>
        </div>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '6px' }}>{t('costs.monthsOfData', 'Months of Data')}</p>
          <p style={{ color: '#fff', fontSize: '30px', fontWeight: 700 }}>{trends.length}</p>
        </div>
      </div>

      {/* Trend Chart */}
      {trends.length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#e5e7eb' }}>
            {t('costs.monthlyTrends', 'Monthly Cost Trends')}
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '192px' }}>
            {trends.map((month) => (
              <div key={month.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                  {formatAmount(month.total, summary?.currency ?? null, lng, true)}
                </span>
                <div
                  style={{
                    width: '100%',
                    background: 'linear-gradient(to top, #2563eb, #60a5fa)',
                    borderRadius: '4px 4px 0 0',
                    height: `${trendBarPercent(month.total, maxTotal)}%`,
                    minHeight: month.total > 0 ? '4px' : '0',
                    transition: 'all 0.2s',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>{formatMonthLabel(month.period, lng)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Account Breakdown */}
      {summary && Object.keys(summary.accounts).length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#e5e7eb' }}>
            {t('costs.accountBreakdown', 'Account Breakdown')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortAccountsByCost(summary.accounts).map(([accountId, account]) => (
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
                <span style={{ fontWeight: 600, color: '#fff' }}>{formatCurrency(account.totalCost, account.currency, lng)}</span>
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
          <p style={{ fontSize: '18px', color: '#d1d5db', marginBottom: '8px' }}>{t('costs.emptyTitle', 'No cost data available yet.')}</p>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            {t('costs.emptyHint', 'Enable data collection for your accounts in the Admin panel to start tracking costs.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
