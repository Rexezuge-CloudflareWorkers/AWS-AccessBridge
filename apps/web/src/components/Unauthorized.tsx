'use client';

import { useTranslation } from 'react-i18next';
import { Unauthorized as SdkUnauthorized } from '@rexezuge/web';

/**
 * Shown when the app has no usable profile. `reason` distinguishes the two cases
 * that look alike but need opposite responses from the reader: an expired session
 * (re-authenticate) versus a failed profile load (the credentials may still be
 * fine — a 500 or a dropped connection must not read as "you are signed out").
 * Offering the Zero Trust login button for the second case sends the user to a
 * page that cannot fix it.
 */
export default function Unauthorized({ reason }: { reason?: string | null }) {
  const { t } = useTranslation();
  if (!reason) {
    return (
      <SdkUnauthorized
        title={t('auth.required', 'Authentication Required')}
        message={t('auth.description', 'Please authenticate with Cloudflare Zero Trust to access this application.')}
        actionLabel={t('auth.authenticate', 'Authenticate With Cloudflare Zero Trust')}
      />
    );
  }
  return (
    <div className="bg-gray-900 min-h-screen text-white flex items-center justify-center">
      <div className="text-center px-6">
        <div className="text-3xl font-semibold mb-1 tracking-tight">
          <span className="text-blue-400">AWS</span> AccessBridge
        </div>
        <h1 className="text-lg font-medium mt-4 mb-1">{t('auth.loadFailedTitle', 'Could Not Load Your Profile')}</h1>
        <p className="text-gray-400 text-sm">
          {t(
            'auth.loadFailedDescription',
            'Your session may still be valid. Reload to try again; if this persists, contact an administrator.',
          )}
        </p>
        <p className="text-red-400 text-xs mt-3 break-words">{reason}</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded text-sm font-medium transition-colors"
        >
          {t('auth.retry', 'Reload')}
        </button>
      </div>
    </div>
  );
}
