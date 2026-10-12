import { useNotice, type ShowNotice, type UseNoticeOptions } from '@rexezuge/web';

type ShowMessage = ShowNotice;

/**
 * Keep the app's toast prop shape while SDK `useNotice` owns its timer and state.
 */
function useToast(options?: UseNoticeOptions) {
  const { notice, showNotice, dismissNotice } = useNotice(options);
  return {
    message: notice === null ? null : { type: notice.kind, text: notice.message },
    showMessage: showNotice,
    dismiss: dismissNotice,
  };
}

export { useToast };
export type { ShowMessage };
