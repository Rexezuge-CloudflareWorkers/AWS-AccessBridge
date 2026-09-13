import { apiRequest } from '../lib/api';

interface CurrentUser {
  email?: string;
  isSuperAdmin?: boolean;
  demoMode?: boolean;
  preferredLanguage?: string | null;
}

async function loadCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>('/user/me');
}

async function updatePreferredLanguage(preferredLanguage: string | null): Promise<void> {
  await apiRequest<void>('/user/me', { method: 'PUT', body: { preferredLanguage } });
}

export type { CurrentUser };
export { loadCurrentUser, updatePreferredLanguage };
