'use client';

import { useCallback, useState } from 'react';
import { queryAuditLogs, type AuditLogEntry } from '../services/auditService';

/**
 * Audit-logs domain hook (vertical slice). Previously `AuditLogsTab.tsx`
 * (285 lines) mixed filters + query + table in one closure.
 */
function useAuditLogs(onError: (message: string) => void) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [action, setAction] = useState('');

  const search = useCallback(
    async (options?: { userEmail?: string; action?: string }) => {
      setIsLoading(true);
      try {
        const result = await queryAuditLogs({
          userEmail: options?.userEmail ?? userEmail ?? undefined,
          action: options?.action ?? action ?? undefined,
          limit: 50,
          offset: 0,
        });
        setLogs(result.logs);
        setTotal(result.total);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load audit logs');
      } finally {
        setIsLoading(false);
      }
    },
    [action, onError, userEmail],
  );

  return { logs, total, isLoading, userEmail, action, setUserEmail, setAction, search };
}

export { useAuditLogs };
