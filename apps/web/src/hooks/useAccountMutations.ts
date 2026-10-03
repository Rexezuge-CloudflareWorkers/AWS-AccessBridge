'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isUnauthorized } from '../lib/api';
import { assumeRoleKeys, buildFederateUrl, setFavorite, setRoleHidden } from '../services/accountService';
import type { RoleMap } from '../services/accountService';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import type { ShowMessage } from './useToast';

/**
 * The mutations behind the account list, with their loading state.
 *
 * Extracted from `AccountList`, which held them inline alongside ~180 lines of
 * markup. Two of them — `toggleFavorite` and `toggleHidden` — apply their change
 * optimistically and restore the previous value if the write fails, which is
 * real logic that was untestable while buried in a component and is now
 * directly assertable.
 */
interface UseAccountMutations {
  rolesData: RoleMap;
  setRolesData: React.Dispatch<React.SetStateAction<RoleMap>>;
  /**
   * The account whose access keys are currently being fetched, if any.
   */
  loadingKeys: string | null;
  /**
   * The account whose console link is being opened, if any.
   */
  loadingConsole: string | null;
  /**
   * Populated when a role's temporary keys have arrived.
   */
  modalData: AccessKeysResponse | null;
  setModalData: (data: AccessKeysResponse | null) => void;
  toggleFavorite: (accountId: string) => Promise<void>;
  toggleHidden: (accountId: string, role: string, currentlyHidden: boolean) => Promise<void>;
  openAccessKeys: (accountId: string, role: string) => Promise<void>;
  openConsole: (accountId: string, role: string) => void;
}

function useAccountMutations(showMessage: ShowMessage, showHidden: boolean): UseAccountMutations {
  const { t } = useTranslation();
  const [rolesData, setRolesData] = useState<RoleMap>({});
  const [loadingKeys, setLoadingKeys] = useState<string | null>(null);
  const [loadingConsole, setLoadingConsole] = useState<string | null>(null);
  const [modalData, setModalData] = useState<AccessKeysResponse | null>(null);

  // One failure path for every action here. `alert()` was duplicated four times in
  // the component, which is why these failures were easy to miss in review: the
  // toast is the app's established channel and the user actually sees it.
  const reportFailure = (thrown: unknown): void => {
    const message = thrown instanceof Error ? thrown.message : t('accounts.unknownError', 'Unknown error occurred');
    showMessage('error', `${t('common.errorPrefix', 'Error')}: ${message}`);
  };

  const toggleFavorite = async (accountId: string): Promise<void> => {
    const isFavorite = rolesData[accountId]?.favorite;

    try {
      await setFavorite(accountId, isFavorite);
      setRolesData((prev) => ({
        ...prev,
        [accountId]: {
          ...prev[accountId],
          favorite: !isFavorite,
        },
      }));
    } catch (error) {
      // Nothing was applied optimistically here, so there is nothing to roll back.
      reportFailure(error);
    }
  };

  const toggleHidden = async (accountId: string, role: string, currentlyHidden: boolean): Promise<void> => {
    const previous = rolesData[accountId];
    if (!previous) return;

    const nextRoles: string[] = currentlyHidden ? [...previous.roles, role] : previous.roles.filter((r) => r !== role);
    const prevHidden: string[] = previous.hiddenRoles ?? [];
    // `hiddenRoles` only mirrors what the list is currently *showing*: with the
    // "show hidden" filter on, a role being hidden must move from `roles` to
    // `hiddenRoles` so the row is not lost; with the filter off it simply leaves
    // the visible list, and recording it here would list a role the user cannot
    // see. Either way the server is authoritative — toggling the filter refetches,
    // so a stale mirror is never shown.
    const nextHidden: string[] = currentlyHidden ? prevHidden.filter((r) => r !== role) : showHidden ? [...prevHidden, role] : prevHidden;

    setRolesData((prev) => ({
      ...prev,
      [accountId]: { ...previous, roles: nextRoles, hiddenRoles: nextHidden },
    }));

    try {
      await setRoleHidden(accountId, role, !currentlyHidden);
    } catch (error) {
      // Restore the snapshot: the optimistic update is a guess about what the
      // server accepted, and it must not outlive a failed write.
      setRolesData((prev) => ({ ...prev, [accountId]: previous }));
      reportFailure(error);
    }
  };

  const openAccessKeys = async (accountId: string, role: string): Promise<void> => {
    const loadingKey = `${accountId}-${role}`;
    setLoadingKeys(loadingKey);
    try {
      setModalData(await assumeRoleKeys(accountId, role));
    } catch (error) {
      if (isUnauthorized(error)) {
        globalThis.location.reload();
        return;
      }
      reportFailure(error);
    } finally {
      setLoadingKeys(null);
    }
  };

  const openConsole = (accountId: string, role: string): void => {
    const loadingKey = `${accountId}-${role}`;
    setLoadingConsole(loadingKey);
    try {
      globalThis.window.open(buildFederateUrl(accountId, role), '_blank', 'noopener,noreferrer');
    } catch (error) {
      // Popup blockers reject rather than throw, so this is a reachable path and
      // otherwise the click would look like it did nothing.
      reportFailure(error);
    } finally {
      setLoadingConsole(null);
    }
  };

  return {
    rolesData,
    setRolesData,
    loadingKeys,
    loadingConsole,
    modalData,
    setModalData,
    toggleFavorite,
    toggleHidden,
    openAccessKeys,
    openConsole,
  };
}

export type { UseAccountMutations };
export { useAccountMutations };