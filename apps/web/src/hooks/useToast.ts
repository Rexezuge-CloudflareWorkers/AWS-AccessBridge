'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

type ToastType = 'success' | 'error';

interface Toast {
  type: ToastType;
  text: string;
}

/**
 * Reports a transient outcome. The canonical type: components take this rather
 * than re-spelling `(type: 'success' | 'error', text: string) => void`, which had
 * been copy-pasted into every feature tab's props.
 */
type ShowMessage = (type: ToastType, text: string) => void;

function useToast(dismissAfterMs: number = 5000) {
  const [message, setMessage] = useState<Toast | null>(null);
  // The pending dismissal, so a new toast replaces the old one's timer instead of
  // being dismissed early by it, and so unmounting does not leave a timer that
  // calls `setState` on a gone component.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearPendingDismissal = useCallback(() => {
    if (timer.current === undefined) {
      return;
    }

    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const showMessage = useCallback(
    (type: ToastType, text: string) => {
      clearPendingDismissal();
      setMessage({ type, text });
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setMessage(null);
      }, dismissAfterMs);
    },
    [clearPendingDismissal, dismissAfterMs],
  );

  const dismiss = useCallback(() => {
    clearPendingDismissal();
    setMessage(null);
  }, [clearPendingDismissal]);

  useEffect(() => clearPendingDismissal, [clearPendingDismissal]);

  return { message, showMessage, dismiss };
}

export { useToast };
export type { ShowMessage, Toast, ToastType };