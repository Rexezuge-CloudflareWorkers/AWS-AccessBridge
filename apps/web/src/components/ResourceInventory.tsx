'use client';

import { useTranslation } from 'react-i18next';
import Spinner from './ui/Spinner';
import Pagination from './ui/Pagination';
import ResourceRow from './ResourceRow';
import ResourceSummaryCards from './ResourceSummaryCards';
import { getConsoleDestination } from '../services/resourceService';
import { buildFederateUrl } from '../services/accountService';
import type { ConsoleDestination, ResourceItem } from '../services/resourceService';
import { useResources } from '../hooks/useResources';
import { totalPages as countPages } from '../lib/pagination';

export default function ResourceInventory() {
  const { t } = useTranslation();
  const {
    summary,
    summaryError,
    resources,
    total,
    rolesByAccount,
    selectedRoles,
    setSelectedRoles,
    isLoading,
    resourcesError,
    filterType,
    setFilterType,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    pageSize,
  } = useResources();

  const totalPages = countPages(total, pageSize);

  const handleOpenResource = (resource: ResourceItem) => {
    const role: string | undefined = selectedRoles[resource.awsAccountId] || rolesByAccount[resource.awsAccountId]?.[0];
    const destination: ConsoleDestination | null = getConsoleDestination(resource);
    if (!role || !destination) return;

    window.open(
      buildFederateUrl(resource.awsAccountId, role, { destinationPath: destination.path, destinationRegion: destination.region }),
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Summary Cards */}
      {/* Distinguishable from "no resources match", which renders no summary panel
          at all — a failed summary call previously looked identical. */}
      {summaryError && <div style={{ color: '#f87171', fontSize: '0.875rem' }}>{summaryError}</div>}
      {summary && <ResourceSummaryCards summary={summary} />}

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          background: '#1e2433',
          padding: '16px',
          borderRadius: '12px',
        }}
      >
        <div>
          <label className="text-xs font-medium" style={{ display: 'block', color: '#9ca3af', marginBottom: '6px' }}>
            {t('resources.typeLabel', 'Type')}
          </label>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setPage(0);
            }}
            className="text-sm"
            style={{
              padding: '8px',
              background: '#252d3d',
              borderRadius: '8px',
              border: 'none',
              color: '#fff',
              outline: 'none',
            }}
          >
            <option value="">{t('resources.allTypes', 'All Types')}</option>
            <option value="ec2">EC2</option>
            <option value="s3">S3</option>
            <option value="lambda">Lambda</option>
            <option value="rds">RDS</option>
            <option value="dynamodb">DynamoDB</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label className="text-xs font-medium" style={{ display: 'block', color: '#9ca3af', marginBottom: '6px' }}>
            {t('resources.searchLabel', 'Search')}
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            placeholder={t('resources.searchPlaceholder', 'Search by name or ID')}
            className="text-sm"
            style={{
              width: '100%',
              padding: '8px',
              background: '#252d3d',
              borderRadius: '8px',
              border: 'none',
              color: '#fff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <span className="text-sm" style={{ color: '#6b7280', paddingBottom: '2px' }}>
          {t('resources.resultsCount', '{{total}} results', { total })}
        </span>
      </div>

      {/* Resource Table */}
      {isLoading ? (
        <Spinner size={24} padding="32px 0" />
      ) : resourcesError && resources.length === 0 ? (
        // A failed load is not "no resources found"; saying so would invite the
        // user to conclude the account is empty.
        <div style={{ background: 'rgba(127, 29, 29, 0.3)', color: '#fca5a5', padding: '12px 16px', borderRadius: '12px' }}>
          {resourcesError}
        </div>
      ) : resources.length === 0 ? (
        <div
          style={{
            background: '#1e2433',
            padding: '48px',
            borderRadius: '12px',
            textAlign: 'center',
          }}
        >
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
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <p className="text-lg" style={{ color: '#d1d5db', marginBottom: '8px' }}>
            {t('resources.emptyTitle', 'No resources found.')}
          </p>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            {t('resources.emptyHint', 'Enable resource collection for your accounts in the Admin panel.')}
          </p>
        </div>
      ) : (
        <div
          style={{
            background: '#1e2433',
            borderRadius: '12px',
            overflowX: 'auto',
          }}
        >
          <table className="text-sm" style={{ width: '100%', minWidth: '940px', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.typeHeader', 'Type')}
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.nameHeader', 'Name')}
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.accountHeader', 'Account')}
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.regionHeader', 'Region')}
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.stateHeader', 'State')}
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  {t('resources.openHeader', 'Open')}
                </th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r, idx) => {
                return (
                  <ResourceRow
                    key={`${r.awsAccountId}-${r.resourceType}-${r.resourceId}`}
                    resource={r}
                    accountRoles={rolesByAccount[r.awsAccountId] || []}
                    selectedRole={selectedRoles[r.awsAccountId] || (rolesByAccount[r.awsAccountId] || [])[0] || ''}
                    isFirst={idx === 0}
                    onSelectRole={(awsAccountId, role) => setSelectedRoles((previous) => ({ ...previous, [awsAccountId]: role }))}
                    onOpen={handleOpenResource}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={page + 1} totalPages={totalPages} onPageChange={(p) => setPage(p - 1)} variant="compact" />
    </div>
  );
}
