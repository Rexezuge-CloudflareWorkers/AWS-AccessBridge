import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { syncHtmlLang } from './lib/locale';
import AccountList from './components/AccountList';
import AdminPage from './components/AdminPage';
import CostDashboard from './components/CostDashboard';
import ResourceInventory from './components/ResourceInventory';
import SpaNavbar from './components/SpaNavbar';
import Unauthorized from './components/Unauthorized';
import Spinner from './components/ui/Spinner';
import Pagination from './components/ui/Pagination';
import { useAuth } from './hooks/useAuth';
import { useRouter, type View } from './hooks/useRouter';

export default function SpaApp() {
  const { t, i18n } = useTranslation();
  const { isAuthorized, isSuperAdmin, isDemoMode, userEmail } = useAuth();
  const { currentView, adminTab, navigateTo } = useRouter();
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

  const navigateToView = useCallback(
    (view: View) => {
      navigateTo(view);
    },
    [navigateTo],
  );

  const handleAdminTabChange = useCallback(
    (tab: string) => {
      navigateTo('admin', tab);
    },
    [navigateTo],
  );

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
      <SpaNavbar isSuperAdmin={isSuperAdmin} currentView={currentView} setCurrentView={navigateToView} userEmail={userEmail} />
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
