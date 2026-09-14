'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import type { View } from '../hooks/useRouter';

interface SpaNavbarProps {
  isSuperAdmin: boolean;
  currentView: View;
  setCurrentView: (view: View) => void;
  userEmail: string;
  language: string;
  onLanguageChange: (lng: string) => void;
  languageDisabled?: boolean;
}

function NavTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 16px',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s',
        background: active ? '#2563eb' : hovered ? 'rgba(55,65,81,0.5)' : 'transparent',
        color: active || hovered ? '#fff' : '#9ca3af',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Top navbar extracted from `SpaApp.tsx`. Pure presentational shell.
 */
export default function SpaNavbar({
  isSuperAdmin,
  currentView,
  setCurrentView,
  userEmail,
  language,
  onLanguageChange,
  languageDisabled,
}: SpaNavbarProps) {
  const { t } = useTranslation();
  const viewLabels: Record<View, string> = {
    accounts: t('nav.accounts', 'Accounts'),
    costs: t('nav.costs', 'Costs'),
    resources: t('nav.resources', 'Resources'),
    admin: t('nav.admin', 'Admin'),
  };
  return (
    <nav
      className="text-white flex justify-between items-center"
      style={{
        padding: '12px 24px',
        background: 'rgba(17, 24, 39, 0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1e2433',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.025em' }}>
          <span style={{ color: '#60a5fa' }}>AWS</span> AccessBridge
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(30,36,51,0.5)', padding: '4px', borderRadius: '8px' }}>
          {(['accounts', 'costs', 'resources'] as const).map((view) => (
            <NavTab key={view} active={currentView === view} onClick={() => setCurrentView(view)}>
              {viewLabels[view]}
            </NavTab>
          ))}
          {isSuperAdmin && (
            <NavTab active={currentView === 'admin'} onClick={() => setCurrentView('admin')}>
              {viewLabels.admin}
            </NavTab>
          )}
        </div>
      </div>
      <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <LanguageSelector value={language} onChange={onLanguageChange} disabled={languageDisabled} />
        {isSuperAdmin && (
          <span
            style={{
              background: 'rgba(245,158,11,0.15)',
              color: '#fbbf24',
              padding: '2px 10px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
            }}
          >
            {t('nav.adminBadge', 'ADMIN')}
          </span>
        )}
        <span style={{ color: '#9ca3af' }}>{userEmail}</span>
      </div>
    </nav>
  );
}
