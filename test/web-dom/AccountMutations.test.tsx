import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAccountMutations } from '@aws-access-bridge/web/hooks/useAccountMutations';
import * as accountService from '@aws-access-bridge/web/services/accountService';
import { ApiError } from '@aws-access-bridge/web/lib/api';
import type { ShowMessage } from '@aws-access-bridge/web/hooks/useToast';

/**
 * The account list's optimistic mutations.
 *
 * `toggleFavorite` and `toggleHidden` apply their change immediately and restore
 * the previous value if the write fails. That rollback is the whole point — a
 * favourite that does not stick, or a role that vanishes, is a wrong answer the
 * user has to notice themselves — and it was untestable while it sat inline in a
 * 322-line component next to ~180 lines of markup.
 */
vi.mock('@aws-access-bridge/web/services/accountService');

const mocked = vi.mocked(accountService);

describe('useAccountMutations', () => {
  let showMessage: ReturnType<typeof vi.fn<ShowMessage>>;

  function hook(showHidden = false) {
    return renderHook(() => useAccountMutations(showMessage, showHidden));
  }

  function seed(result: { current: ReturnType<typeof useAccountMutations> }, roles: Record<string, unknown>): void {
    act(() => {
      result.current.setRolesData(roles as never);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    showMessage = vi.fn();
    vi.stubGlobal('open', vi.fn());
    // jsdom implements neither; both are exercised by the handlers below.
    vi.stubGlobal('location', { reload: vi.fn(), pathname: '/user/' });
    // `openConsole` composes the federate URL, and the real builder is covered by
    // `test/schema/SharedConstantsConsolidation.test.ts`; here it only has to
    // return something identifiable, so stub it rather than re-assert it.
    mocked.buildFederateUrl.mockImplementation((accountId, role) => `/user/aws/federate?awsAccountId=${accountId}&role=${role}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('toggleFavorite', () => {
    it('applies the new favourite state on success', async () => {
      mocked.setFavorite.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: [], favorite: false } });

      await act(async () => {
        await result.current.toggleFavorite('111111111111');
      });

      // The write carries the *previous* value, which is what the route expects.
      expect(mocked.setFavorite).toHaveBeenCalledWith('111111111111', false);
      expect(result.current.rolesData['111111111111'].favorite).toBe(true);
    });

    it('flips an existing favourite back off', async () => {
      mocked.setFavorite.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: [], favorite: true } });

      await act(async () => {
        await result.current.toggleFavorite('111111111111');
      });

      expect(mocked.setFavorite).toHaveBeenCalledWith('111111111111', true);
      expect(result.current.rolesData['111111111111'].favorite).toBe(false);
    });

    it('preserves the account’s other fields', async () => {
      mocked.setFavorite.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: ['Dev'], favorite: false, hiddenRoles: ['Ops'] } });

      await act(async () => {
        await result.current.toggleFavorite('111111111111');
      });

      expect(result.current.rolesData['111111111111']).toMatchObject({ roles: ['Dev'], hiddenRoles: ['Ops'], favorite: true });
    });

    it('reports a failure and leaves the state untouched', async () => {
      // Nothing was applied optimistically, so there is nothing to roll back —
      // and crucially the UI must not show a favourite that was never saved.
      mocked.setFavorite.mockRejectedValue(new Error('write failed'));
      const { result } = hook();
      seed(result, { '111111111111': { roles: [], favorite: false } });

      await act(async () => {
        await result.current.toggleFavorite('111111111111');
      });

      expect(result.current.rolesData['111111111111'].favorite).toBe(false);
      expect(showMessage).toHaveBeenCalledWith('error', expect.stringContaining('write failed'));
    });

    it('sends undefined for an account with no known favourite state', async () => {
      mocked.setFavorite.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: [] } });

      await act(async () => {
        await result.current.toggleFavorite('111111111111');
      });

      expect(mocked.setFavorite).toHaveBeenCalledWith('111111111111', undefined);
    });
  });

  describe('toggleHidden', () => {
    it('removes a role from the visible list', async () => {
      mocked.setRoleHidden.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: ['Dev', 'Ops'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', false);
      });

      expect(mocked.setRoleHidden).toHaveBeenCalledWith('111111111111', 'Dev', true);
      expect(result.current.rolesData['111111111111'].roles).toEqual(['Ops']);
      // With the "show hidden" filter off, `hiddenRoles` is not mirrored: the
      // role simply leaves the visible list, and the next fetch is authoritative.
      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual([]);
    });

    it('moves the role into hiddenRoles when the filter is showing hidden rows', async () => {
      // Otherwise the row would vanish entirely instead of moving to the
      // hidden section the user is currently looking at.
      mocked.setRoleHidden.mockResolvedValue(undefined);
      const { result } = hook(true);
      seed(result, { '111111111111': { roles: ['Dev', 'Ops'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', false);
      });

      expect(result.current.rolesData['111111111111'].roles).toEqual(['Ops']);
      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual(['Dev']);
    });

    it('restores a role and clears it from hidden', async () => {
      mocked.setRoleHidden.mockResolvedValue(undefined);
      const { result } = hook();
      seed(result, { '111111111111': { roles: ['Ops'], hiddenRoles: ['Dev'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', true);
      });

      expect(mocked.setRoleHidden).toHaveBeenCalledWith('111111111111', 'Dev', false);
      expect(result.current.rolesData['111111111111'].roles).toEqual(['Ops', 'Dev']);
      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual([]);
    });

    it('rolls back the optimistic update when the write fails', async () => {
      // The regression this extraction makes testable: without the rollback the
      // row would disappear and never come back until the next list fetch.
      mocked.setRoleHidden.mockRejectedValue(new Error('denied'));
      const { result } = hook();
      seed(result, { '111111111111': { roles: ['Dev', 'Ops'], hiddenRoles: ['Old'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', false);
      });

      expect(result.current.rolesData['111111111111'].roles).toEqual(['Dev', 'Ops']);
      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual(['Old']);
      expect(showMessage).toHaveBeenCalledWith('error', expect.stringContaining('denied'));
    });

    it('rolls back a failed restore to hidden state too', async () => {
      mocked.setRoleHidden.mockRejectedValue(new Error('denied'));
      const { result } = hook();
      seed(result, { '111111111111': { roles: ['Ops'], hiddenRoles: ['Dev'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', true);
      });

      expect(result.current.rolesData['111111111111'].roles).toEqual(['Ops']);
      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual(['Dev']);
    });

    it('does nothing for an unknown account', async () => {
      const { result } = hook();

      await act(async () => {
        await result.current.toggleHidden('999999999999', 'Dev', false);
      });

      // No write, and no crash — an account missing from the map is a render
      // race, not a user error.
      expect(mocked.setRoleHidden).not.toHaveBeenCalled();
      expect(showMessage).not.toHaveBeenCalled();
    });

    it('appends rather than duplicating a role already hidden', async () => {
      mocked.setRoleHidden.mockResolvedValue(undefined);
      const { result } = hook(true);
      seed(result, { '111111111111': { roles: ['Ops'], hiddenRoles: ['Dev'], favorite: false } });

      await act(async () => {
        await result.current.toggleHidden('111111111111', 'Dev', false);
      });

      expect(result.current.rolesData['111111111111'].hiddenRoles).toEqual(['Dev', 'Dev']);
    });
  });

  describe('openAccessKeys', () => {
    it('stores the credentials for the modal', async () => {
      const creds = { accessKeyId: 'AK', secretAccessKey: 'SK' };
      mocked.assumeRoleKeys.mockResolvedValue(creds as never);
      const { result } = hook();

      await act(async () => {
        await result.current.openAccessKeys('111111111111', 'Dev');
      });

      expect(mocked.assumeRoleKeys).toHaveBeenCalledWith('111111111111', 'Dev');
      expect(result.current.modalData).toEqual(creds);
    });

    it('exposes a per-role loading key while the fetch is in flight, then clears it', async () => {
      // Held open deliberately: React batches the `setLoadingKeys` from the same
      // tick as the call, so reading it synchronously afterwards would only
      // observe the settled state.
      let release!: (value: unknown) => void;
      mocked.assumeRoleKeys.mockReturnValue(new Promise((resolve) => (release = resolve)) as never);
      const { result } = hook();

      let pending: Promise<void>;
      act(() => {
        pending = result.current.openAccessKeys('111111111111', 'Dev');
      });

      await waitFor(() => {
        expect(result.current.loadingKeys).toBe('111111111111-Dev');
      });

      await act(async () => {
        release({});
        await pending!;
      });
      expect(result.current.loadingKeys).toBeNull();
    });

    it('clears the loading key even when the fetch fails', async () => {
      // A stuck spinner would disable every row's keys button forever.
      mocked.assumeRoleKeys.mockRejectedValue(new Error('sts unavailable'));
      const { result } = hook();

      await act(async () => {
        await result.current.openAccessKeys('111111111111', 'Dev');
      });

      expect(result.current.loadingKeys).toBeNull();
      expect(result.current.modalData).toBeNull();
      expect(showMessage).toHaveBeenCalledWith('error', expect.stringContaining('sts unavailable'));
    });

    it('reloads the page on a 401 instead of showing an error toast', async () => {
      // A dead session is not something a toast can fix.
      mocked.assumeRoleKeys.mockRejectedValue(new ApiError(401, 'expired'));
      const { result } = hook();

      await act(async () => {
        await result.current.openAccessKeys('111111111111', 'Dev');
      });

      expect(globalThis.location.reload).toHaveBeenCalledOnce();
      expect(showMessage).not.toHaveBeenCalled();
    });
  });

  describe('openConsole', () => {
    it('opens the federate URL in a new tab', () => {
      const { result } = hook();

      act(() => {
        result.current.openConsole('111111111111', 'Dev');
      });

      expect(globalThis.open).toHaveBeenCalledWith('/user/aws/federate?awsAccountId=111111111111&role=Dev', '_blank', 'noopener,noreferrer');
    });

    it('reports a blocked popup instead of appearing to do nothing', () => {
      // Popup blockers reject rather than throw, so a silent failure here means
      // the click looks inert.
      vi.mocked(globalThis.open).mockImplementation(() => {
        throw new Error('popup blocked');
      });
      const { result } = hook();

      act(() => {
        result.current.openConsole('111111111111', 'Dev');
      });

      expect(showMessage).toHaveBeenCalledWith('error', expect.stringContaining('popup blocked'));
    });

    it('clears the loading key even when the popup is blocked', () => {
      vi.mocked(globalThis.open).mockImplementation(() => {
        throw new Error('popup blocked');
      });
      const { result } = hook();

      act(() => {
        result.current.openConsole('111111111111', 'Dev');
      });

      expect(result.current.loadingConsole).toBeNull();
    });
  });
});