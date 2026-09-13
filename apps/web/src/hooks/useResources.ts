'use client';

import { useEffect, useState } from 'react';
import { isUnauthorized } from '../lib/api';
import { listResources, loadSummary } from '../services/resourceService';
import type { ResourceItem, ResourceSummary } from '../services/resourceService';

/**
 * Resource inventory domain hook (vertical slice). Previously
 * `ResourceInventory.tsx` (389 lines) mixed filter + fetch + table +
 * pagination in one closure with 9× `useState`.
 */
function useResources() {
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
    loadSummary()
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    listResources({ filterType, searchQuery, pageSize, page })
      .then((data) => {
        setResources(data.items);
        setTotal(data.total);
        setRolesByAccount(data.rolesByAccount || {});
        setSelectedRoles((previous) => {
          const next: Record<string, string> = { ...previous };
          const byAccount = data.rolesByAccount || {};
          for (const [accountId, roles] of Object.entries(byAccount)) {
            if (roles.length > 0 && (next[accountId] === undefined || !roles.includes(next[accountId]))) {
              next[accountId] = roles[0];
            }
          }
          return next;
        });
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (isUnauthorized(err)) {
          globalThis.location.reload();
          return;
        }
        setIsLoading(false);
      });
  }, [filterType, searchQuery, page]);

  return {
    summary,
    resources,
    total,
    rolesByAccount,
    selectedRoles,
    setSelectedRoles,
    isLoading,
    filterType,
    setFilterType,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    pageSize,
  };
}

export { useResources };
