'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import OnboardingWizard from './OnboardingWizard';
import AuditLogsTab from './AuditLogsTab';
import TeamsTab from './TeamsTab';
import CredentialsTab from './admin/CredentialsTab';
import AccessTab from './admin/AccessTab';
import AccountsTab from './admin/AccountsTab';
import RoleConfigTab from './admin/RoleConfigTab';
import SpendAlertsTab from './admin/SpendAlertsTab';
import DataCollectionTab from './admin/DataCollectionTab';
import MaintenanceTab from './admin/MaintenanceTab';
import { useToast } from '../hooks/useToast';

interface AdminPageProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export default function AdminPage({ activeTab: activeTabProp, onTabChange }: AdminPageProps = {}) {
  const { t } = useTranslation();
  const activeTab: string = activeTabProp || 'wizard';
  const { message, showMessage, dismiss } = useToast();

  const tabGroups = [
    { header: t('admin.setupHeader', 'Setup'), tabs: [{ id: 'wizard', label: t('admin.wizardTab', 'Setup Wizard') }] },
    {
      header: t('admin.configurationHeader', 'Configuration'),
      tabs: [
        { id: 'credentials', label: t('admin.credentialsTab', 'Credentials') },
        { id: 'accounts', label: t('admin.nicknamesTab', 'Account Nicknames') },
        { id: 'roleconfig', label: t('admin.roleConfigTab', 'Role Config') },
      ],
    },
    {
      header: t('admin.accessHeader', 'Access'),
      tabs: [
        { id: 'access', label: t('admin.accessTab', 'User Access') },
        { id: 'teams', label: t('admin.teamsTab', 'Teams') },
      ],
    },
    {
      header: t('admin.monitoringHeader', 'Monitoring'),
      tabs: [
        { id: 'spendalerts', label: t('admin.spendAlertsTab', 'Spend Alerts') },
        { id: 'datacollection', label: t('admin.dataCollectionTab', 'Data Collection') },
      ],
    },
    {
      header: t('admin.systemHeader', 'System'),
      tabs: [
        { id: 'auditlogs', label: t('admin.auditLogsTab', 'Audit Logs') },
        { id: 'maintenance', label: t('admin.maintenanceTab', 'Maintenance') },
      ],
    },
  ];

  return (
    <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '32px 24px' }}>
      {message &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="animate-slide-down"
            style={{
              position: 'fixed',
              top: '48px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 50,
              padding: '12px 24px',
              borderRadius: '12px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
              background: message.type === 'success' ? 'rgba(22,163,74,0.9)' : 'rgba(220,38,38,0.9)',
              backdropFilter: 'blur(8px)',
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>{message.text}</span>
              <button onClick={dismiss} style={{ color: 'rgba(255,255,255,0.8)', background: 'none', border: 'none', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          </div>,
          document.body,
        )}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <aside
          style={{
            width: '220px',
            flexShrink: 0,
            background: '#1e2433',
            borderRadius: '12px',
            padding: '8px',
            position: 'sticky',
            top: '24px',
          }}
        >
          {tabGroups.map((group, idx) => (
            <div key={group.header} style={{ marginTop: idx === 0 ? 0 : '12px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#6b7280',
                  padding: '8px 12px 4px',
                }}
              >
                {group.header}
              </div>
              {group.tabs.map((tab) => (
                <SidebarTab key={tab.id} active={activeTab === tab.id} onClick={() => onTabChange?.(tab.id)}>
                  {tab.label}
                </SidebarTab>
              ))}
            </div>
          ))}
        </aside>

        <div className="animate-fade-in-up" style={{ flex: 1, minWidth: 0 }}>
          {activeTab === 'wizard' && <OnboardingWizard showMessage={showMessage} />}
          {activeTab === 'credentials' && <CredentialsTab showMessage={showMessage} />}
          {activeTab === 'access' && <AccessTab showMessage={showMessage} />}
          {activeTab === 'accounts' && <AccountsTab showMessage={showMessage} />}
          {activeTab === 'roleconfig' && <RoleConfigTab showMessage={showMessage} />}
          {activeTab === 'teams' && <TeamsTab showMessage={showMessage} />}
          {activeTab === 'spendalerts' && <SpendAlertsTab showMessage={showMessage} />}
          {activeTab === 'datacollection' && <DataCollectionTab showMessage={showMessage} />}
          {activeTab === 'auditlogs' && <AuditLogsTab showMessage={showMessage} />}
          {activeTab === 'maintenance' && <MaintenanceTab showMessage={showMessage} />}
        </div>
      </div>
    </div>
  );
}

function SidebarTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: active ? '#2563eb' : hovered ? 'rgba(55,65,81,0.5)' : 'transparent',
    color: active || hovered ? '#ffffff' : '#9ca3af',
    boxShadow: active ? '0 4px 6px -1px rgba(37,99,235,0.2)' : 'none',
  };

  return (
    <button onClick={onClick} style={style} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
    </button>
  );
}
