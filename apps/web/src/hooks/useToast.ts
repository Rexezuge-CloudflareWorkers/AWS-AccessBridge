'use client';

import { useState, useCallback } from 'react';

type ToastType = 'success' | 'error';

interface Toast {
  type: ToastType;
  text: string;
}

function useToast(dismissAfterMs: number = 5000) {
  const [message, setMessage] = useState<Toast | null>(null);

  const showMessage = useCallback(
    (type: ToastType, text: string) => {
      setMessage({ type, text });
      setTimeout(() => setMessage(null), dismissAfterMs);
    },
    [dismissAfterMs],
  );

  const dismiss = useCallback(() => {
    setMessage(null);
  }, []);

  return { message, showMessage, dismiss };
}

export { useToast };
export type { Toast, ToastType };
