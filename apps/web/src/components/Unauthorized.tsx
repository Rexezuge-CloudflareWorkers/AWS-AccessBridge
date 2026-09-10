'use client';

import { ZERO_TRUST_AUTHENTICATION_PATH } from '../lib/constants';

function authenticateWithZeroTrust(): void {
  globalThis.location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
}

export default function Unauthorized() {
  return (
    <div className="bg-gray-900 min-h-screen text-white flex items-center justify-center">
      <div className="text-center px-6">
        <div className="text-3xl font-semibold mb-1 tracking-tight">
          <span className="text-blue-400">AWS</span> AccessBridge
        </div>
        <h1 className="text-lg font-medium mt-4 mb-1">Authentication Required</h1>
        <p className="text-gray-400 text-sm">Please authenticate with Cloudflare Zero Trust to access this application.</p>
        <button
          type="button"
          onClick={authenticateWithZeroTrust}
          className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded text-sm font-medium transition-colors"
        >
          Authenticate with Cloudflare Zero Trust
        </button>
      </div>
    </div>
  );
}
