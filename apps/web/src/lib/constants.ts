'use client';

// Path that is always protected by Cloudflare Access. Navigating here triggers
// the Zero Trust login flow when the user has no valid session; after login,
// Access redirects back to the application home.
export const ZERO_TRUST_AUTHENTICATION_PATH = '/';
