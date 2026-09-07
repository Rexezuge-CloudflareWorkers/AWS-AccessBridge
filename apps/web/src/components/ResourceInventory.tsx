'use client';

import { useState, useEffect, useCallback } from 'react';
import Spinner from './ui/Spinner';
import Pagination from './ui/Pagination';

interface ResourceItem {
  awsAccountId: string;
  region: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  metadata: Record<string, string>;
}

interface ResourceSummary {
  totalResources: number;
  byType: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

interface ConsoleDestination {
  path: string;
  region?: string;
}

const TYPE_LABELS: Record<string, string> = {
  ec2: 'EC2 Instances',
  s3: 'S3 Buckets',
  lambda: 'Lambda Functions',
  rds: 'RDS Databases',
  dynamodb: 'DynamoDB Tables',
};

const getConsoleDestination = (resource: ResourceItem): ConsoleDestination | null => {
  const region: string | undefined = resource.region && resource.region !== 'global' ? resource.region : undefined;
  switch (resource.resourceType) {
    case 'ec2':
      return { path: `ec2/home#InstanceDetails:instanceId=${encodeURIComponent(resource.resourceId)}`, region };
    case 's3':
      return { path: `s3/buckets/${encodeURIComponent(resource.resourceName || resource.resourceId)}`, region };
    case 'lambda':
      return { path: `lambda/home#/functions/${encodeURIComponent(resource.resourceName || resource.resourceId)}`, region };
    case 'rds':
      return { path: `rds/home#database:id=${encodeURIComponent(resource.resourceId)};is-cluster=false`, region };
    case 'dynamodb':
      return {
        path: `dynamodbv2/home#table?name=${encodeURIComponent(resource.resourceName || resource.resourceId.split(':').pop() || resource.resourceId)}`,
        region,
      };
    default:
      return null;
  }
};

export default function ResourceInventory() {
  const [summary, setSummary] = useState<ResourceSummary | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rolesByAccount, setRolesByAccount] = useState<Record<string, string[]>>({});
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    fetch('/api/resources/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSummary(data as ResourceSummary);
      });
  }, []);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    params.set('limit', pageSize.toString());
    params.set('offset', (page * pageSize).toString());

    try {
      const res = await fetch(`/api/resources?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { items: ResourceItem[]; total: number; rolesByAccount: Record<string, string[]> };
        setResources(data.items);
        setTotal(data.total);
        setRolesByAccount(data.rolesByAccount || {});
        setSelectedRoles((previous) => {
          const next: Record<string, string> = { ...previous };
          for (const [accountId, roles] of Object.entries(data.rolesByAccount || {})) {
            if (roles.length > 0 && (!next[accountId] || !roles.includes(next[accountId]))) {
              next[accountId] = roles[0];
            }
          }
          return next;
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [filterType, searchQuery, page]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const totalPages = Math.ceil(total / pageSize);
  const stateColor = (state: string): string => {
    if (['running', 'active', 'Active', 'available'].includes(state)) return '#4ade80';
    if (['stopped', 'inactive'].includes(state)) return '#f87171';
    return '#facc15';
  };

  const handleOpenResource = (resource: ResourceItem) => {
    const role: string | undefined = selectedRoles[resource.awsAccountId] || rolesByAccount[resource.awsAccountId]?.[0];
    const destination: ConsoleDestination | null = getConsoleDestination(resource);
    if (!role || !destination) return;

    const params = new URLSearchParams({
      awsAccountId: resource.awsAccountId,
      role,
      destinationPath: destination.path,
    });
    if (destination.region) {
      params.set('destinationRegion', destination.region);
    }
    window.open(`/api/aws/federate?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Summary Cards */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${1 + Object.keys(summary.byType).length}, 1fr)`,
            gap: '12px',
          }}
        >
          <div
            style={{
              background: '#1e2433',
              padding: '16px',
              borderRadius: '12px',
              textAlign: 'center',
            }}
          >
            <p className="text-2xl font-bold" style={{ color: '#fff' }}>
              {summary.totalResources}
            </p>
            <p className="text-xs" style={{ color: '#9ca3af', marginTop: '4px' }}>
              Total
            </p>
          </div>
          {Object.entries(summary.byType).map(([type, count]) => (
            <div
              key={type}
              style={{
                background: '#1e2433',
                padding: '16px',
                borderRadius: '12px',
                textAlign: 'center',
              }}
            >
              <p className="text-2xl font-bold" style={{ color: '#fff' }}>
                {count}
              </p>
              <p className="text-xs" style={{ color: '#9ca3af', marginTop: '4px' }}>
                {TYPE_LABELS[type] || type}
              </p>
            </div>
          ))}
        </div>
      )}

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
            Type
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
            <option value="">All Types</option>
            <option value="ec2">EC2</option>
            <option value="s3">S3</option>
            <option value="lambda">Lambda</option>
            <option value="rds">RDS</option>
            <option value="dynamodb">DynamoDB</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label className="text-xs font-medium" style={{ display: 'block', color: '#9ca3af', marginBottom: '6px' }}>
            Search
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search by name or ID"
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
          {total} results
        </span>
      </div>

      {/* Resource Table */}
      {isLoading ? (
        <Spinner size={24} padding="32px 0" />
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
            No resources found.
          </p>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            Enable resource collection for your accounts in the Admin panel.
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
                  Type
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  Name
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  Account
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  Region
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  State
                </th>
                <th
                  className="text-xs uppercase tracking-wider font-medium"
                  style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', background: '#252d3d' }}
                >
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r, idx) => {
                const accountRoles: string[] = rolesByAccount[r.awsAccountId] || [];
                const selectedRole: string = selectedRoles[r.awsAccountId] || accountRoles[0] || '';
                const canOpen: boolean = Boolean(selectedRole && getConsoleDestination(r));
                return (
                  <tr
                    key={`${r.awsAccountId}-${r.resourceType}-${r.resourceId}`}
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid #2d3748',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#252d3d';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <td className="font-medium uppercase text-xs" style={{ padding: '12px', color: '#d1d5db' }}>
                      {r.resourceType}
                    </td>
                    <td style={{ padding: '12px', color: '#fff' }}>{r.resourceName}</td>
                    <td className="font-mono text-xs" style={{ padding: '12px', color: '#9ca3af' }}>
                      {r.awsAccountId}
                    </td>
                    <td style={{ padding: '12px', color: '#9ca3af' }}>{r.region}</td>
                    <td style={{ padding: '12px', color: stateColor(r.state) }}>{r.state}</td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <select
                          value={selectedRole}
                          disabled={accountRoles.length === 0}
                          onChange={(e) => setSelectedRoles((previous) => ({ ...previous, [r.awsAccountId]: e.target.value }))}
                          className="text-xs"
                          aria-label={`Role for ${r.resourceName || r.resourceId}`}
                          style={{
                            maxWidth: '150px',
                            padding: '7px 8px',
                            background: '#111827',
                            borderRadius: '8px',
                            border: '1px solid #374151',
                            color: '#e5e7eb',
                            outline: 'none',
                            opacity: accountRoles.length === 0 ? 0.45 : 1,
                          }}
                        >
                          {accountRoles.length === 0 ? (
                            <option value="">No role</option>
                          ) : (
                            accountRoles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleOpenResource(r)}
                          disabled={!canOpen}
                          className="text-xs font-medium"
                          title={canOpen ? 'Open resource in AWS Console' : 'No console destination available'}
                          style={{
                            padding: '8px 12px',
                            background: canOpen ? '#2563eb' : '#374151',
                            borderRadius: '8px',
                            border: 'none',
                            color: '#fff',
                            cursor: canOpen ? 'pointer' : 'default',
                            opacity: canOpen ? 1 : 0.5,
                            whiteSpace: 'nowrap',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            if (canOpen) (e.currentTarget as HTMLElement).style.background = '#1d4ed8';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = canOpen ? '#2563eb' : '#374151';
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
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
