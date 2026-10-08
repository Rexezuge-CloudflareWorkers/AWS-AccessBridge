import type { AsyncActions } from '../useAsyncAction';
import type { ShowMessage } from '../useToast';

/**
 * What every per-step hook is handed: the toast channel, for the client-side
 * checks that fail before any request is made, and the wizard's single
 * `useAsyncAction`, so the steps share one busy flag and one failure path.
 */
interface StepDeps {
  showMessage: ShowMessage;
  actions: AsyncActions;
}

export type { StepDeps };
