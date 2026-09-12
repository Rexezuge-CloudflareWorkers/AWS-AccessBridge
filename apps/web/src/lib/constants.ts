'use client';

// Path that is always protected by Cloudflare Access. Navigating here triggers
// the Zero Trust login flow when the user has no valid session; after login,
// Access redirects back to the application home.
export const ZERO_TRUST_AUTHENTICATION_PATH = '/';

// The built-in team that always exists. It cannot be deleted; the UI locks
// its delete action and the API rejects deletion (see TeamService).
export const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000000';
