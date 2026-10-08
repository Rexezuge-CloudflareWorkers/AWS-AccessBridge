'use client';

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultRoleSelection } from '../lib/roleSelection';
import { useResource } from './useResource';
import { listResources, loadSummary } from '../services/resourceService';
import type { ResourceItem } from '../services/resourceService';

const PAGE_SIZE = 25;

// Module-level so "no data yet" keeps one identity across renders.
const NO_RESOURCES: ResourceItem[] = [];
const NO_ROLES: Record<string, string[]> = {};

/**
 * Resource inventory domain hook (vertical slice). Previously
 * `ResourceInventory.tsx` (389 lines) mixed filter + fetch + table +
 * pagination in one closure with 9× `useState`.
 *
 * Both reads are `useResource`s. The list's fetcher is keyed on the filter,
 * search and page, so typing in the search box is a new fetcher and the request
 * guard inside `useResource` retires the slower earlier request instead of
 * rendering page 0's rows under a page-2 selection.
 */
function useResources() {
  const { t } = useTranslation();
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);

  // The summary is supplementary — the table below still works — so its failure
  // must not blank the whole view. It is surfaced as `summaryError` so the panel
  // can say so: swallowing it made "no resources match" and "the summary call
  // failed" indistinguishable.
  const summaryResource = useResource(loadSummary, {
    errorFallback: t('resources.summaryLoadFailed', 'Failed to load the resource summary.'),
  });

  const fetchResources = useCallback(
    () => listResources({ filterType, searchQuery, pageSize: PAGE_SIZE, page }),
    [filterType, searchQuery, page],
  );
  const listResource = useResource(fetchResources, {
    errorFallback: t('resources.loadError', 'Failed to load resources.'),
    reloadOnUnauthorized: true,
    onSuccess: (data) => {
      setSelectedRoles((previous) => defaultRoleSelection(previous, data.rolesByAccount ?? NO_ROLES));
    },
  });

  return {
    summary: summaryResource.data ?? null,
    summaryError: summaryResource.error,
    resources: listResource.data?.items ?? NO_RESOURCES,
    total: listResource.data?.total ?? 0,
    rolesByAccount: listResource.data?.rolesByAccount ?? NO_ROLES,
    selectedRoles,
    setSelectedRoles,
    isLoading: listResource.isLoading,
    resourcesError: listResource.error,
    filterType,
    setFilterType,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    pageSize: PAGE_SIZE,
  };
}

export { useResources };
