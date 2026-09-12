import { readJson } from '../lib/api';

interface CurrentUser {
  email?: string;
  isSuperAdmin?: boolean;
  demoMode?: boolean;
  preferredLanguage?: string | null;
}

async function loadCurrentUser(): Promise<CurrentUser> {
  const response = await fetch('/user/me');
  if (!response.ok) {
    throw new Error(`Authentication check failed: ${response.status}`);
  }
  return readJson<CurrentUser>(response);
}

async function updatePreferredLanguage(preferredLanguage: string | null): Promise<void> {
  const response = await fetch('/user/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferredLanguage }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save language preference: ${response.status}`);
  }
}

export type { CurrentUser };
export { loadCurrentUser, updatePreferredLanguage };
