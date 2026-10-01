'use client';

import { useEffect, useRef, useState } from 'react';
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
  // Monotonic request id, the guard `useTeams` already uses. Typing in the search
  // box fires overlapping requests; without it a slower earlier one can resolve
  // last and render page 0's rows under the page-2 selection.
  const requestId = useRef(0);

  useEffect(() => {
    loadSummary()
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const currentRequest: number = ++requestId.current;
    listResources({ filterType, searchQuery, pageSize, page })
      .then((data) => {
        if (currentRequest !== requestId.current) {
          return;
        }
        setResources(data.items);
        setTotal(data.total);
        const byAccount: Record<string, string[]> = data.rolesByAccount || {};
        setRolesByAccount(byAccount);
        setSelectedRoles((previous) => {
          const next: Record<string, string> = { ...previous };
          let changed = false;
          for (const [accountId, roles] of Object.entries(byAccount)) {
            if (!(roles.length > 0 && (next[accountId] === undefined || !roles.includes(next[accountId])))) {
              continue;
            }

            next[accountId] = roles[0];
            changed = true;
          }
          // Returning `previous` when nothing needed defaulting keeps the object
          // identity stable, and so avoids an extra render on every fetch.
          return changed ? next : previous;
        });
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (currentRequest !== requestId.current) {
          return;
        }
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
