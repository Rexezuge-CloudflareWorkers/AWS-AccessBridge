'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUnixTimestamp } from '../lib/format';
import Spinner from './ui/Spinner';
import Pagination from './ui/Pagination';
import { apiFetch } from '../lib/api';
import { cardStyle, tableCardStyle, inputStyle, btnBlueStyle, thStyle, tdStyle } from './ui/theme';

interface AuditLog {
  logId: string;
  timestamp: number;
  userEmail: string;
  action: string;
  resource?: string;
  method: string;
  path: string;
  statusCode: number;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}

function statusColorStyle(code: number): React.CSSProperties {
  if (code < 300) return { color: '#4ade80' };
  if (code < 400) return { color: '#facc15' };
  return { color: '#f87171' };
}

interface AuditLogsTabProps {
  showMessage: (type: 'success' | 'error', text: string) => void;
}

const styles = {
  card: { ...cardStyle, padding: '16px' },
  tableCard: tableCardStyle,
  input: { ...inputStyle, width: 'auto', padding: '8px 12px' },
  btnBlue: { ...btnBlueStyle, padding: '8px 16px' },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  th: thStyle,
  td: tdStyle,
  expandedRow: {
    background: '#181d2a',
    padding: '16px',
    borderTop: '1px solid rgba(55,65,81,0.3)',
  } as React.CSSProperties,
};

export default function AuditLogsTab({ showMessage: _showMessage }: AuditLogsTabProps) {
  const { t, i18n } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // Filters
  const [filterEmail, setFilterEmail] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    const params = new URLSearchParams();
    if (filterEmail.trim()) params.set('userEmail', filterEmail.trim());
    if (filterAction.trim()) params.set('action', filterAction.trim());
    params.set('limit', pageSize.toString());
    params.set('offset', (page * pageSize).toString());

    apiFetch<{ logs: AuditLog[]; total: number }>(`/user/admin/audit-logs?${params.toString()}`)
      .then((result) => {
        if (result.ok && result.data) {
          setLogs(result.data.logs);
          setTotal(result.data.total);
          setError(null);
        } else {
          setError(result.error || t('audit.loadError', 'Failed to load audit logs'));
        }
        setIsLoading(false);
      })
      .catch(() => {
        setError(t('audit.loadError', 'Failed to load audit logs'));
        setIsLoading(false);
      });
  }, [filterEmail, filterAction, page, refreshIndex, t]);

  const totalPages = Math.ceil(total / pageSize);

  const getInputStyle = (name: string): React.CSSProperties => ({
    ...styles.input,
    borderColor: focusedInput === name ? '#3b82f6' : '#374151',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Filter bar */}
      <div style={styles.card}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="font-medium" style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>
              {t('audit.emailFilter', 'User Email')}
            </label>
            <input
              type="text"
              value={filterEmail}
              onChange={(e) => {
                setFilterEmail(e.target.value);
                setPage(0);
              }}
              placeholder={t('audit.emailPlaceholder', 'Filter by email')}
              className="text-sm"
              style={getInputStyle('email')}
              onFocus={() => setFocusedInput('email')}
              onBlur={() => setFocusedInput(null)}
            />
          </div>
          <div>
            <label className="font-medium" style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>
              {t('audit.actionHeader', 'Action')}
            </label>
            <input
              type="text"
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value);
                setPage(0);
              }}
              placeholder={t('audit.actionPlaceholder', 'e.g. ASSUME_ROLE')}
              className="text-sm"
              style={getInputStyle('action')}
              onFocus={() => setFocusedInput('action')}
              onBlur={() => setFocusedInput(null)}
            />
          </div>
          <button
            onClick={() => setRefreshIndex((i) => i + 1)}
            className="text-sm font-medium"
            style={styles.btnBlue}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1d4ed8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
          >
            {t('common.refresh', 'Refresh')}
          </button>
          <span className="text-sm" style={{ color: '#6b7280', marginLeft: 'auto' }}>
            {t('audit.totalEntries', '{{total}} total entries', { total })}
          </span>
        </div>
      </div>

      {/* Loading spinner */}
      {isLoading && <Spinner size={24} />}

      {/* Error state */}
      {!isLoading && error && (
        <div style={{ background: 'rgba(127, 29, 29, 0.3)', color: '#fca5a5', padding: '12px 16px', borderRadius: '12px' }}>{error}</div>
      )}

      {/* Empty state */}
      {!isLoading && !error && logs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280' }}>{t('audit.emptyTitle', 'No audit logs found.')}</div>
      )}

      {/* Table */}
      {!isLoading && logs.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table} className="text-sm">
            <thead>
              <tr>
                <th className="font-medium text-xs" style={styles.th}>
                  {t('audit.timeHeader', 'Time')}
                </th>
                <th className="font-medium text-xs" style={styles.th}>
                  {t('audit.userHeader', 'User')}
                </th>
                <th className="font-medium text-xs" style={styles.th}>
                  {t('audit.actionHeader', 'Action')}
                </th>
                <th className="font-medium text-xs" style={styles.th}>
                  {t('audit.methodHeader', 'Method')}
                </th>
                <th className="font-medium text-xs" style={styles.th}>
                  {t('audit.statusHeader', 'Status')}
                </th>
                <th className="font-medium text-xs" style={styles.th}>
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <>
                  <tr
                    key={log.logId}
                    className="cursor-pointer"
                    style={{
                      ...styles.td,
                      background: hoveredRow === log.logId ? '#252d3d' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => setExpandedLog(expandedLog === log.logId ? null : log.logId)}
                    onMouseEnter={() => setHoveredRow(log.logId)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td className="whitespace-nowrap" style={{ ...styles.td, color: '#d1d5db' }}>
                      {formatUnixTimestamp(log.timestamp, i18n.resolvedLanguage ?? 'en')}
                    </td>
                    <td style={{ ...styles.td, color: '#d1d5db' }}>
                      <div className="truncate" style={{ maxWidth: '200px' }} title={log.userEmail}>
                        {log.userEmail}
                      </div>
                    </td>
                    <td className="font-medium" style={{ ...styles.td, color: 'white' }}>
                      {log.action}
                    </td>
                    <td style={{ ...styles.td, color: '#9ca3af' }}>{log.method}</td>
                    <td className="font-mono" style={{ ...styles.td, ...statusColorStyle(log.statusCode) }}>
                      {log.statusCode}
                    </td>
                    <td className="text-xs" style={{ ...styles.td, color: '#6b7280' }}>
                      {log.ipAddress || '-'}
                    </td>
                  </tr>
                  {expandedLog === log.logId && (
                    <tr key={`${log.logId}-detail`}>
                      <td colSpan={6} style={styles.expandedRow}>
                        <div className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db' }}>
                          <div>
                            <span className="font-medium" style={{ color: '#6b7280' }}>
                              {t('audit.pathLabel', 'Path:')}
                            </span>{' '}
                            <span className="font-mono">{log.path}</span>
                          </div>
                          {log.resource && (
                            <div>
                              <span className="font-medium" style={{ color: '#6b7280' }}>
                                {t('audit.resourceLabel', 'Resource:')}
                              </span>{' '}
                              {log.resource}
                            </div>
                          )}
                          {log.detail && (
                            <div>
                              <span className="font-medium" style={{ color: '#6b7280' }}>
                                {t('audit.detailLabel', 'Detail:')}
                              </span>{' '}
                              {log.detail}
                            </div>
                          )}
                          {log.userAgent && (
                            <div>
                              <span className="font-medium" style={{ color: '#6b7280' }}>
                                {t('audit.userAgentLabel', 'User Agent:')}
                              </span>{' '}
                              {log.userAgent}
                            </div>
                          )}
                          <div>
                            <span className="font-medium" style={{ color: '#6b7280' }}>
                              {t('audit.logIdLabel', 'Log ID:')}
                            </span>{' '}
                            <span className="font-mono">{log.logId}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <Pagination currentPage={page + 1} totalPages={totalPages} onPageChange={(p) => setPage(p - 1)} variant="compact" />
    </div>
  );
}
