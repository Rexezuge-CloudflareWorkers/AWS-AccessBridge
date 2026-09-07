'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AccessKeyModal from './AccessKeyModal';
import Spinner from './ui/Spinner';
import type { AccessKeysResponse } from '@aws-access-bridge/shared';
import { buildPrincipalArn } from '@aws-access-bridge/shared';

type RoleMap = Record<string, { roles: string[]; hiddenRoles?: string[]; nickname?: string; favorite: boolean }>;

interface AccountListProps {
  showHidden: boolean;
  searchTerm: string;
  pageSize: number;
  currentPage: number;
  setTotalAccounts: (count: number) => void;
}

export default function AccountList({ showHidden, searchTerm, pageSize, currentPage, setTotalAccounts }: AccountListProps) {
  const [rolesData, setRolesData] = useState<RoleMap>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modalData, setModalData] = useState<AccessKeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<string | null>(null);
  const [loadingConsole, setLoadingConsole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);

    let url: string;
    if (searchTerm.trim()) {
      const params = new URLSearchParams();
      params.set('q', searchTerm.trim());
      if (showHidden) params.set('showHidden', 'true');
      url = `/api/user/assumables/search?${params.toString()}`;
    } else {
      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams();
      if (showHidden) params.set('showHidden', 'true');
      params.set('limit', pageSize.toString());
      params.set('offset', offset.toString());
      url = `/api/user/assumables?${params.toString()}`;
    }

    try {
      const res = await fetch(url);
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) {
        const errorData = (await res.json().catch(() => null)) as { Exception?: { Message?: string } } | null;
        const errorMsg = errorData?.Exception?.Message || `Failed to load accounts: ${res.status} ${res.statusText}`;
        throw new Error(errorMsg);
      }

      const data = (await res.json()) as RoleMap & { totalAccounts?: number };
      if (data) {
        if (searchTerm.trim()) {
          setRolesData(data);
          setTotalAccounts(Object.keys(data).length);
        } else {
          const { totalAccounts: total, ...accounts } = data;
          setRolesData(accounts);
          setTotalAccounts(total ?? 0);
        }
        setExpanded(Object.fromEntries(Object.keys(searchTerm.trim() ? data : data).map((id) => [id, false])));
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AWS accounts');
    } finally {
      setIsLoading(false);
    }
  }, [showHidden, currentPage, pageSize, searchTerm, setTotalAccounts]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleFavorite = async (accountId: string) => {
    const isFavorite = rolesData[accountId]?.favorite;

    try {
      const response = await fetch('/api/user/favorites', {
        method: isFavorite ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awsAccountId: accountId }),
      });

      if (response.status === 401) {
        window.location.reload();
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to ${isFavorite ? 'unfavorite' : 'favorite'} account`);
      }

      setRolesData((prev) => ({
        ...prev,
        [accountId]: {
          ...prev[accountId],
          favorite: !isFavorite,
        },
      }));
    } catch (error) {
      console.error(error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    }
  };

  const toggleHidden = async (accountId: string, role: string, currentlyHidden: boolean) => {
    const previous = rolesData[accountId];
    if (!previous) return;

    const nextRoles: string[] = currentlyHidden ? [...previous.roles, role] : previous.roles.filter((r) => r !== role);
    const prevHidden: string[] = previous.hiddenRoles ?? [];
    const nextHidden: string[] = currentlyHidden ? prevHidden.filter((r) => r !== role) : showHidden ? [...prevHidden, role] : prevHidden;

    setRolesData((prev) => ({
      ...prev,
      [accountId]: { ...previous, roles: nextRoles, hiddenRoles: nextHidden },
    }));

    try {
      const response = await fetch('/api/user/assumable/hidden', {
        method: currentlyHidden ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awsAccountId: accountId, roleName: role }),
      });

      if (response.status === 401) {
        window.location.reload();
        return;
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as { Exception?: { Message?: string } } | null;
        throw new Error(errorData?.Exception?.Message || `Failed to ${currentlyHidden ? 'unhide' : 'hide'} role`);
      }
    } catch (error) {
      setRolesData((prev) => ({ ...prev, [accountId]: previous }));
      console.error(error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    }
  };

  const handleAccessKeys = async (accountId: string, role: string) => {
    const principalArn = buildPrincipalArn(accountId, role);
    const loadingKey = `${accountId}-${role}`;

    setLoadingKeys(loadingKey);
    try {
      const assumeRes = await fetch('/api/aws/assume-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ principalArn }),
      });

      if (assumeRes.status === 401) {
        window.location.reload();
        return;
      }

      if (!assumeRes.ok) {
        const errorText = await assumeRes.text();
        throw new Error(`Assume role failed: ${assumeRes.status} ${errorText}`);
      }

      const creds = (await assumeRes.json()) as AccessKeysResponse;
      setModalData(creds);
    } catch (error) {
      console.error(error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      setLoadingKeys(null);
    }
  };

  const handleConsole = async (accountId: string, role: string) => {
    const loadingKey = `${accountId}-${role}`;
    setLoadingConsole(loadingKey);
    try {
      const federateUrl = `/federate?awsAccountId=${accountId}&role=${encodeURIComponent(role)}`;
      window.open(federateUrl, '_blank');
    } catch (error) {
      console.error(error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      setLoadingConsole(null);
    }
  };

  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [hoveredEye, setHoveredEye] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState<{
    key: string;
    accountId: string;
    role: string;
    roleHidden: boolean;
    top: number;
    right: number;
  } | null>(null);

  useEffect(() => {
    if (!confirmHide) return;
    const close = () => setConfirmHide(null);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [confirmHide]);

  return (
    <div>
      {isLoading && <Spinner size={32} label="Loading Accounts..." padding="32px 0" />}
      {!isLoading && error && (
        <div
          style={{
            background: 'rgba(127, 29, 29, 0.3)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <svg style={{ width: '20px', height: '20px', marginRight: '8px', color: '#f87171' }} fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}
      {!error && Object.keys(rolesData).length === 0 && !isLoading && (
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
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p style={{ fontSize: '18px', color: '#d1d5db', marginBottom: '8px' }}>No AWS accounts available</p>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            You don't have access to any AWS accounts. Contact your administrator to request access.
          </p>
        </div>
      )}
      {!isLoading &&
        Object.entries(rolesData).map(([accountId, accountData]) => (
          <div
            key={accountId}
            className="animate-fade-in-up"
            style={{
              background: '#1e2433',
              borderRadius: '12px',
              padding: '16px',
              marginTop: '12px',
              marginBottom: '12px',
              color: '#ffffff',
              transition: 'background 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                className="group"
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}
                onClick={() => toggleExpand(accountId)}
              >
                <svg
                  width="14"
                  height="14"
                  className="shrink-0 group-hover:text-gray-300"
                  style={{
                    marginRight: '12px',
                    color: '#6b7280',
                    transition: 'transform 0.2s, color 0.2s',
                    transform: expanded[accountId] ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <div className="font-semibold" style={{ fontSize: '16px' }}>
                  {accountData.nickname ? (
                    <>
                      <span style={{ color: '#f3f4f6' }}>{accountData.nickname}</span>{' '}
                      <span className="font-normal" style={{ color: '#6b7280', fontSize: '14px', marginLeft: '4px' }}>
                        {accountId}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono" style={{ color: '#e5e7eb' }}>
                      {accountId}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleFavorite(accountId)}
                style={{
                  fontSize: '20px',
                  marginLeft: '16px',
                  transition: 'transform 0.15s',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={accountData.favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {accountData.favorite ? '\u2B50' : '\u2606'}
              </button>
            </div>
            {(() => {
              const allRoles: Array<{ name: string; hidden: boolean }> = [
                ...accountData.roles.map((name) => ({ name, hidden: false })),
                ...(accountData.hiddenRoles ?? []).map((name) => ({ name, hidden: true })),
              ];
              return (
                <div
                  style={{
                    overflow: 'hidden',
                    transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out',
                    maxHeight: expanded[accountId] ? `${allRoles.length * 44 + 16}px` : '0px',
                    opacity: expanded[accountId] ? 1 : 0,
                  }}
                >
                  <div style={{ marginLeft: '28px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {allRoles.map(({ name: role, hidden: roleHidden }) => {
                      const loadingKey = `${accountId}-${role}`;
                      const isLoadingKeys = loadingKeys === loadingKey;
                      const isLoadingConsole = loadingConsole === loadingKey;
                      const isHovered = hoveredRole === loadingKey;
                      const isEyeHovered = hoveredEye === loadingKey;

                      return (
                        <div
                          key={role}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            background: isHovered ? '#252d3d' : 'transparent',
                            transition: 'background 0.15s',
                            opacity: roleHidden ? 0.55 : 1,
                          }}
                          onMouseEnter={() => setHoveredRole(loadingKey)}
                          onMouseLeave={() => setHoveredRole(null)}
                        >
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (!isLoadingConsole) handleConsole(accountId, role);
                            }}
                            className={`transition-colors ${
                              isLoadingConsole ? 'text-gray-400 cursor-not-allowed' : 'text-blue-400 hover:text-blue-300'
                            }`}
                            style={{ textDecoration: 'none' }}
                          >
                            {isLoadingConsole ? 'Opening Console...' : role}
                          </a>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirmHide?.key === loadingKey) {
                                  setConfirmHide(null);
                                  return;
                                }
                                const rect = e.currentTarget.getBoundingClientRect();
                                setConfirmHide({
                                  key: loadingKey,
                                  accountId,
                                  role,
                                  roleHidden,
                                  top: rect.bottom + 10,
                                  right: Math.max(8, window.innerWidth - rect.right - 4),
                                });
                              }}
                              onMouseEnter={() => setHoveredEye(loadingKey)}
                              onMouseLeave={() => setHoveredEye(null)}
                              title={roleHidden ? 'Unhide role' : 'Hide role'}
                              aria-label={roleHidden ? 'Unhide role' : 'Hide role'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '24px',
                                height: '24px',
                                padding: 0,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: isEyeHovered ? '#f87171' : '#6b7280',
                                transition: 'color 0.15s',
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                                <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                                {roleHidden && <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />}
                              </svg>
                            </button>
                            <button
                              className="text-sm"
                              style={{
                                transition: 'color 0.15s',
                                color: isLoadingKeys ? '#9ca3af' : isHovered ? '#60a5fa' : '#6b7280',
                                background: 'none',
                                border: 'none',
                                cursor: isLoadingKeys ? 'default' : 'pointer',
                              }}
                              onClick={() => handleAccessKeys(accountId, role)}
                              disabled={isLoadingKeys}
                            >
                              {isLoadingKeys ? 'Loading...' : 'Access Keys'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}

      {modalData && <AccessKeyModal {...modalData} onClose={() => setModalData(null)} />}

      {confirmHide &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={confirmHide.roleHidden ? 'Confirm unhide role' : 'Confirm hide role'}
            style={{
              position: 'fixed',
              top: confirmHide.top,
              right: confirmHide.right,
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '10px',
              padding: '10px 12px',
              boxShadow: '0 10px 20px -5px rgba(0, 0, 0, 0.6)',
              whiteSpace: 'nowrap',
              zIndex: 50,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-5px',
                right: '10px',
                width: '10px',
                height: '10px',
                background: '#111827',
                borderLeft: '1px solid #374151',
                borderTop: '1px solid #374151',
                transform: 'rotate(45deg)',
              }}
            />
            <div style={{ fontSize: '12px', color: '#e5e7eb', marginBottom: '8px' }}>
              {confirmHide.roleHidden ? 'Unhide this role?' : 'Hide this role?'}
            </div>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmHide(null);
                }}
                style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #374151',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const { accountId, role, roleHidden } = confirmHide;
                  setConfirmHide(null);
                  toggleHidden(accountId, role, roleHidden);
                }}
                style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: confirmHide.roleHidden ? '#2563eb' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {confirmHide.roleHidden ? 'Unhide' : 'Hide'}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
