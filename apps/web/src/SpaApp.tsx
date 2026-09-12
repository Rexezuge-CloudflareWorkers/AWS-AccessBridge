import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { syncHtmlLang } from './lib/locale';
import LanguageSelector from './components/LanguageSelector';
import AccountList from './components/AccountList';
import AdminPage from './components/AdminPage';
import CostDashboard from './components/CostDashboard';
import ResourceInventory from './components/ResourceInventory';
import Unauthorized from './components/Unauthorized';
import Spinner from './components/ui/Spinner';
import Pagination from './components/ui/Pagination';
import { useAuth } from './hooks/useAuth';

type View = 'accounts' | 'costs' | 'resources' | 'admin';

const PATH_TO_VIEW: Record<string, View> = {
  '/': 'accounts',
  '/costs': 'costs',
  '/resources': 'resources',
};

const VIEW_TO_PATH: Record<View, string> = {
  accounts: '/',
  costs: '/costs',
  resources: '/resources',
  admin: '/admin',
};

function parseRoute(): { view: View; adminTab?: string } {
  const path: string = globalThis.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) {
    const tab: string | undefined = path.split('/', 3)[2] || undefined;
    return { view: 'admin', adminTab: tab };
  }
  return { view: PATH_TO_VIEW[path] ?? 'accounts' };
}

export default function SpaApp() {
  const { t, i18n } = useTranslation();
  const { isAuthorized, isSuperAdmin, isDemoMode, userEmail } = useAuth();
  const [currentView, setCurrentView] = useState<View>(() => parseRoute().view);
  const [adminTab, setAdminTab] = useState<string | undefined>(() => parseRoute().adminTab);
  const [showHidden, setShowHidden] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem('aws-access-bridge-page-size');
    return saved ? Math.trunc(Number(saved)) : 10;
  });
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = sessionStorage.getItem('aws-access-bridge-current-page');
    return saved ? Math.trunc(Number(saved)) : 1;
  });
  const [totalAccounts, setTotalAccounts] = useState(0);

  const handleSetTotalAccounts = useCallback((count: number) => {
    setTotalAccounts(count);
  }, []);

  useEffect(() => {
    localStorage.setItem('aws-access-bridge-page-size', pageSize.toString());
  }, [pageSize]);

  useEffect(() => {
    syncHtmlLang(i18n.resolvedLanguage ?? 'en');
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    sessionStorage.setItem('aws-access-bridge-current-page', currentPage.toString());
  }, [currentPage]);

  const navigateTo = useCallback((view: View, tab?: string) => {
    setCurrentView(view);
    setAdminTab(view === 'admin' ? tab : undefined);
    const path: string = view === 'admin' && tab ? `/admin/${tab}` : VIEW_TO_PATH[view];
    if (globalThis.location.pathname !== path) {
      history.pushState(null, '', path);
    }
  }, []);

  const handleAdminTabChange = useCallback(
    (tab: string) => {
      navigateTo('admin', tab);
    },
    [navigateTo],
  );

  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute();
      setCurrentView(route.view);
      setAdminTab(route.adminTab);
    };
    globalThis.addEventListener('popstate', onPopState);
    return () => globalThis.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterOpen && !(event.target as Element).closest('.filter-dropdown')) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterOpen]);

  if (isAuthorized === null) {
    return (
      <div className="bg-gray-900 min-h-screen text-white flex items-center justify-center">
        <div className="text-center">
          <Spinner size={48} label={t('nav.loading', 'Loading...')} />
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <Unauthorized />;
  }

  return (
    <div className="bg-gray-900 min-h-screen text-white">
      {isDemoMode && (
        <div className="bg-gradient-to-r from-yellow-500 to-amber-500 text-black text-center py-2 font-semibold text-sm sticky top-0 z-50 shadow-md">
          {t('nav.demoBanner', 'Demo Mode — Data shown is for demonstration purposes only. Admin operations are disabled.')}
        </div>
      )}
      <SpaNavbar isSuperAdmin={isSuperAdmin} currentView={currentView} setCurrentView={navigateTo} userEmail={userEmail} />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div key={currentView} className="animate-fade-in-up">
          {currentView === 'admin' && isSuperAdmin ? (
            <AdminPage activeTab={adminTab} onTabChange={handleAdminTabChange} />
          ) : currentView === 'costs' ? (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-gray-100">{t('nav.costsHeading', 'Cost Analytics')}</h2>
              <CostDashboard />
            </div>
          ) : currentView === 'resources' ? (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-gray-100">{t('nav.resourcesHeading', 'Resource Inventory')}</h2>
              <ResourceInventory />
            </div>
          ) : (
            <>
              <div className="flex items-center mb-6 gap-4">
                <h2 className="text-2xl font-bold flex-shrink-0 text-gray-100">{t('nav.accountsHeading', 'AWS Accounts')}</h2>
                <div className="flex-1 relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder={t('nav.searchPlaceholder', 'Search by account id or nickname')}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full text-white placeholder-gray-500 focus:outline-none"
                    style={{
                      paddingLeft: '40px',
                      paddingRight: '16px',
                      paddingTop: '10px',
                      paddingBottom: '10px',
                      background: '#1e2433',
                      borderRadius: '8px',
                      border: 'none',
                      fontSize: '14px',
                    }}
                  />
                </div>
                <div className="relative filter-dropdown flex-shrink-0">
                  <button
                    onClick={() => setFilterOpen(!filterOpen)}
                    className="flex items-center gap-1.5 text-gray-300 hover:text-white transition-colors"
                    style={{ padding: '10px 12px', background: '#1e2433', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                      />
                    </svg>
                    {t('nav.filters', 'Filters')}
                  </button>
                  {filterOpen && (
                    <div
                      className="absolute right-0 mt-2 w-52 shadow-xl z-10 animate-slide-down"
                      style={{ background: '#1e2433', borderRadius: '8px' }}
                    >
                      <div className="p-3">
                        <label className="flex items-center cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={showHidden}
                            onChange={(e) => {
                              setShowHidden(e.target.checked);
                              setCurrentPage(1);
                            }}
                            className="mr-2.5 rounded"
                          />
                          {t('nav.includeHidden', 'Include Hidden')}
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-4">
                {!searchTerm.trim() && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">{t('nav.perPage', 'Per page:')}</label>
                      <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        className="text-white text-sm focus:outline-none"
                        style={{ padding: '6px 8px', background: '#252d3d', borderRadius: '6px', border: 'none' }}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                    {totalAccounts > 0 && (
                      <>
                        <div className="text-sm text-gray-500">
                          {t('nav.showingOf', '{{from}}–{{to}} of {{total}}', {
                            from: Math.min((currentPage - 1) * pageSize + 1, totalAccounts),
                            to: Math.min(currentPage * pageSize, totalAccounts),
                            total: totalAccounts,
                          })}
                        </div>
                        <Pagination
                          currentPage={currentPage}
                          totalPages={Math.ceil(totalAccounts / pageSize)}
                          onPageChange={setCurrentPage}
                          variant="full"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
              <AccountList
                showHidden={showHidden}
                searchTerm={searchTerm}
                pageSize={pageSize}
                currentPage={currentPage}
                setTotalAccounts={handleSetTotalAccounts}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SpaNavbar({
  isSuperAdmin,
  currentView,
  setCurrentView,
  userEmail,
}: {
  isSuperAdmin: boolean;
  currentView: View;
  setCurrentView: (view: View) => void;
  userEmail: string;
}) {
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
        <LanguageSelector />
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
