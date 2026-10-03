'use client';

import { useEffect, useState } from 'react';
import { isUnauthorized } from '../lib/api';
import { useRequestGuard } from './useRequestGuard';
import { listResources, loadSummary } from '../services/resourceService';
import type { ResourceItem, ResourceSummary } from '../services/resourceService';

/**
 * Resource inventory domain hook (vertical slice). Previously
 * `ResourceInventory.tsx` (389 lines) mixed filter + fetch + table +
 * pagination in one closure with 9× `useState`.
 */
function useResources() {
  const [summary, setSummary] = useState<ResourceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rolesByAccount, setRolesByAccount] = useState<Record<string, string[]>>({});
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;
  // Typing in the search box fires overlapping requests; without the guard a
  // slower earlier one can resolve last and render page 0's rows under the page-2
  // selection.
  const { begin, isCurrent } = useRequestGuard();

  useEffect(() => {
    loadSummary()
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch((err: unknown) => {
        // The summary is supplementary — the table below still works — so this
        // must not blank the whole view. Previously swallowed with no record,
        // which made "no resources match" and "the summary call failed"
        // indistinguishable in the UI. Surfacing it lets the panel say so.
        setSummaryError(err instanceof Error ? err.message : 'Failed to load the resource summary.');
      });
  }, []);

  useEffect(() => {
    const currentRequest: number = begin();
    listResources({ filterType, searchQuery, pageSize, page })
      .then((data) => {
        if (!isCurrent(currentRequest)) {
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
        if (!isCurrent(currentRequest)) {
          return;
        }
        if (isUnauthorized(err)) {
          globalThis.location.reload();
          return;
        }
        setIsLoading(false);
      });
  }, [filterType, searchQuery, page, begin, isCurrent]);

  return {
    summary,
    summaryError,
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
