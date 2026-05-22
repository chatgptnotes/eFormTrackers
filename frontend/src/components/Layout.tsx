import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Table2, AlertTriangle, Settings, RefreshCw, Menu, X, Clock, Zap,
  Users, FileText, CreditCard, HelpCircle, Building2, BarChart3, Kanban,
  FolderOpen, Folder, ChevronRight, ChevronDown, LayoutGrid, Package,
  DollarSign, Monitor, Scale, Briefcase, Megaphone, ShieldCheck, PlusCircle,
  ClipboardList, Layers, Sun, Moon, ExternalLink, CheckCircle2,
} from 'lucide-react';
import { RefreshConfig, SidebarCategory } from '../types';
import { JFFormMeta } from '../services/formDiscovery';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { canAccessSettings } from '../config/access';
import { SIDEBAR_CATEGORIES } from '../services/mockData';
import NotificationBell from './NotificationBell';
import UserDropdown from './UserDropdown';

interface Props {
  children: ReactNode;
  refreshConfig: RefreshConfig;
  setRefreshConfig: (fn: (prev: RefreshConfig) => RefreshConfig) => void;
  onRefresh: () => void;
  activeForms?: JFFormMeta[];
  activeDepartments?: string[];
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  all: LayoutGrid,
  procurement: Package,
  finance: DollarSign,
  hr: Users,
  it: Monitor,
  operations: Briefcase,
  legal: Scale,
  admin: Building2,
  marketing: Megaphone,
};


export default function Layout({ children, refreshConfig, setRefreshConfig, onRefresh, activeForms, activeDepartments = [] }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgRole, organization, hasPermission } = useAuth();
  const { activeSidebarCategory, setActiveSidebarCategory, activeWorkflowId, setActiveWorkflowId, themeMode, toggleTheme } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [sidebarOpen]);

  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleCategoryClick = (cat: SidebarCategory) => {
    setActiveSidebarCategory(cat.id === activeSidebarCategory?.id ? null : cat);
    navigate('/app/director');
    setSidebarOpen(false);
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const TOOL_NAV = [
    // { path: '/app', icon: LayoutDashboard, label: 'Analytics Dashboard', roles: ['super_admin', 'admin', 'approver'] },
    // { path: '/app/tracker', icon: Table2, label: 'Workflow Tracker', roles: ['super_admin', 'admin', 'approver'] },
    // { path: '/app/bottlenecks', icon: AlertTriangle, label: 'Bottleneck Analysis', roles: ['super_admin', 'admin'] },
    // { path: '/app/kanban', icon: Kanban, label: 'Kanban Board', roles: ['super_admin', 'admin', 'approver'] },
    // { path: '/app/analytics', icon: BarChart3, label: 'Advanced Analytics', roles: ['super_admin', 'admin'] },
    { path: '/app/team', icon: Users, label: 'Team', roles: ['super_admin', 'admin'] },
    // { path: '/app/activity', icon: FileText, label: 'Activity Log', roles: ['super_admin', 'admin'] },
    // { path: '/app/billing', icon: CreditCard, label: 'Billing', roles: ['super_admin'] },
    { path: '/app/org-settings', icon: Building2, label: 'Organization', roles: ['super_admin'] },
    { path: '/app/settings', icon: Settings, label: 'Settings', roles: ['super_admin', 'admin', 'approver'], emailGate: canAccessSettings },
    // { path: '/app/help', icon: HelpCircle, label: 'Help & Support', roles: ['super_admin', 'admin', 'approver', 'viewer'] },
  ].filter(item => item.roles.includes(orgRole) && (!item.emailGate || item.emailGate(user?.email)));

  const currentLabel = location.pathname === '/app/director'
    ? "Dashboard"
    : location.pathname === '/app/modern'
    ? "Modern Dashboard"
    : location.pathname === '/app/completed'
    ? "Completed Requests"
    : TOOL_NAV.find(i => i.path === location.pathname)?.label || 'Dashboard';

  return (
    <div className="min-h-screen flex" style={{ scrollbarGutter: 'stable' }}>
      {/* Sidebar — bg-navy adapts: dark in dark mode, white in light mode */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-gradient-to-b from-blue-950 to-slate-800 border-r border-slate-800 transform transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Logo — FlowAccel branding */}
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              {/* FlowAccel logo mark */}
              <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
                <img src="https://eforms.mediaoffice.ae/enterprise/logo.png" alt="Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-bold text-base tracking-tight" style={{ color: '#ffffff' }}>Flow</span>
                  <span className="font-bold text-base tracking-tight" style={{ color: '#1E88E5' }}>Accel</span>
                </div>
                <p className="text-[10px] text-gray-500 truncate max-w-[160px] leading-tight">{organization?.name || 'Workflow Dashboard'}</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto">
            {/* Submit New Request CTA */}
            <div className="p-4 pb-2">
              <Link
                to="/app/submit-request"
                onClick={() => { setActiveSidebarCategory(null); setSidebarOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 ${
                  location.pathname === '/app/submit-request'
                    ? 'bg-gold/20 text-gold border border-gold/30'
                    : 'bg-gold/10 text-gold border border-gold/20 hover:bg-gold/20'
                }`}
              >
                <PlusCircle className="w-4.5 h-4.5" style={{ color: '#ffffff' }} />
                <span className="text-sm font-semibold">Submit New Request</span>
              </Link>
            </div>

            {/* Section 1: Department Categories */}
            <div className="px-4 pb-2">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-2">Departments</p>

              {/* Dashboard link */}
              <Link
                to="/app/director"
                onClick={() => { setActiveSidebarCategory(null); setSidebarOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 ${
                  location.pathname === '/app/director' && !activeSidebarCategory
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : 'text-white hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-4.5 h-4.5" style={{ color: '#ffffff' }} />
                <span className="text-sm font-medium" style={{ color: '#ffffff' }}>Dashboard</span>
              </Link>

              {/* Modern Dashboard link */}
              <Link
                to="/app/modern"
                onClick={() => { setActiveSidebarCategory(null); setSidebarOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 ${
                  location.pathname === '/app/modern'
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-white hover:bg-slate-800'
                }`}
              >
                <LayoutGrid className="w-4.5 h-4.5" style={{ color: '#ffffff' }} />
                <span className="text-sm font-medium" style={{ color: '#ffffff' }}>Modern Dashboard</span>
              </Link>

              {/* Completed Requests link */}
              <Link
                to="/app/completed"
                onClick={() => { setActiveSidebarCategory(null); setSidebarOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 ${
                  location.pathname === '/app/completed'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'text-white hover:bg-slate-800'
                }`}
              >
                <CheckCircle2 className="w-4.5 h-4.5" style={{ color: '#ffffff' }} />
                <span className="text-sm font-medium" style={{ color: '#ffffff' }}>Completed</span>
              </Link>

              {/* Category items */}
              {SIDEBAR_CATEGORIES.filter(cat => cat.type === 'all' || (cat.filter?.departments && cat.filter.departments.some(d => activeDepartments.includes(d)))).map(cat => {
                const Icon = CATEGORY_ICONS[cat.id] || Folder;
                const isActive = activeSidebarCategory?.id === cat.id;
                const isExpanded = expandedCategories.has(cat.id);
                const hasChildren = cat.children && cat.children.length > 0;

                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => {
                        if (hasChildren) toggleExpand(cat.id, { stopPropagation: () => {} } as React.MouseEvent);
                        handleCategoryClick(cat);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 transition-all duration-200 ${
                        isActive
                          ? 'bg-gold/10 text-gold border border-gold/20'
                          : 'text-white hover:bg-slate-800'
                      }`}
                    >
                      <div style={{ color: '#ffffff' }}>
                        {hasChildren ? (
                          isExpanded ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />
                        ) : (
                          <Icon className="w-4 h-4" />
                        )}
                      </div>
                      <span className="text-sm font-medium flex-1 text-left" style={{ color: '#ffffff' }}>{cat.label}</span>
                      {hasChildren && (
                        <span onClick={(e) => toggleExpand(cat.id, e)}>
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: '#ffffff' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: '#ffffff' }} />}
                        </span>
                      )}
                    </button>

                    {/* Children */}
                    {hasChildren && isExpanded && (
                      <div className="ml-4 pl-3 border-l border-slate-800 space-y-0.5 mb-1">
                        {cat.children!.map(child => {
                          const childActive = activeSidebarCategory?.id === child.id;
                          return (
                            <button
                              key={child.id}
                              onClick={() => handleCategoryClick(child)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                                childActive
                                  ? 'bg-gold/10 text-gold'
                                  : 'text-white hover:bg-slate-800'
                              }`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full ${childActive ? 'bg-gold' : 'bg-gray-600'}`} />
                              <span style={{ color: '#ffffff' }}>{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Section 2: Workflows */}
            <div className="mx-4 border-t border-slate-800 my-2" />
            <div className="px-4 pb-2">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-2">Workflows</p>

              {/* All Workflows */}
              <button
                onClick={() => {
                  setActiveWorkflowId(null);
                  setActiveSidebarCategory(null);
                  navigate('/app/director');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 transition-all duration-200 ${
                  !activeWorkflowId && location.pathname === '/app/director'
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : 'text-white hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" style={{ color: '#ffffff' }} />
                <span className="text-sm font-medium flex-1 text-left" style={{ color: '#ffffff' }}>All Workflows</span>
              </button>

              {(activeForms || []).map(f => ({ id: f.id, label: f.title })).map(wf => {
                const lbl = wf.label.toLowerCase();
                const Icon = lbl.includes('purchase') || lbl.includes('order') ? Package
                  : lbl.includes('task') ? ClipboardList
                  : FileText;
                const isActive = activeWorkflowId === wf.id;
                return (
                  <button
                    key={wf.id}
                    onClick={() => {
                      setActiveWorkflowId(isActive ? null : wf.id);
                      setActiveSidebarCategory(null);
                      navigate('/app/director');
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 transition-all duration-200 ${
                      isActive
                        ? 'bg-gold/10 text-gold border border-gold/20'
                        : 'text-white hover:bg-slate-800'
                    }`}
                  >
                    <div style={{ color: '#ffffff' }}><Icon className="w-4 h-4" /></div>
                    <span className="text-sm font-medium flex-1 text-left leading-tight" style={{ color: '#ffffff' }}>{wf.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Separator */}
            <div className="mx-4 border-t border-slate-800 my-2" />

            {/* Section 3: Tools */}
            <div className="px-4 pt-1 pb-4 space-y-0.5">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-2">Tools</p>
              {TOOL_NAV.map(item => {
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                      active
                        ? 'bg-gold/10 text-gold border border-gold/20'
                        : 'text-white hover:bg-slate-800'
                    }`}
                  >
                    <div style={{ color: '#ffffff' }}><item.icon className="w-4 h-4" /></div>
                    <span className="text-sm font-medium" style={{ color: '#ffffff' }}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Refresh Controls */}
          <div className="p-4 border-t border-slate-800 hidden">
            <div className="p-3 space-y-2 rounded-lg bg-slate-700/20 border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Auto Refresh</span>
                <button
                  onClick={() => setRefreshConfig(prev => ({ ...prev, autoRefresh: !prev.autoRefresh }))}
                  className={`w-9 h-5 rounded-full transition-colors ${refreshConfig.autoRefresh ? 'bg-gold' : 'bg-slate-700'} relative`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform ${refreshConfig.autoRefresh ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </div>
              {refreshConfig.autoRefresh && (
                <select
                  value={refreshConfig.intervalMinutes}
                  onChange={e => setRefreshConfig(prev => ({ ...prev, intervalMinutes: Number(e.target.value) }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-gray-300"
                >
                  <option value={1}>Every 1 min</option>
                  <option value={5}>Every 5 min</option>
                  <option value={15}>Every 15 min</option>
                  <option value={30}>Every 30 min</option>
                </select>
              )}
              {refreshConfig.lastUpdated && (
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <Clock className="w-2.5 h-2.5" />
                  <span>Updated {new Date(refreshConfig.lastUpdated).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 lg:ml-72 h-screen overflow-y-scroll">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-gray-400 hover:text-white">
                {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <div>
                <h2 className="text-lg font-semibold text-white">{currentLabel}</h2>
                <p className="text-xs text-gray-500">{organization?.name || 'Dubai Government Entity'} • Workflow Management</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://eforms.mediaoffice.ae/workspace/team/gdmo-bettroi"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 text-gray-400 hover:text-gold transition-all text-sm font-semibold"
              >
                <ExternalLink className="w-4 h-4" />
                Workspace
              </a>
              <Link
                to="/app/submit-request"
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold/20 hover:bg-gold/30 text-gold text-sm font-semibold transition-all border border-gold/20"
              >
                <PlusCircle className="w-4 h-4" />
                New Request
              </Link>
              <button
                onClick={toggleTheme}
                title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 text-gray-400 hover:text-gold transition-all"
              >
                {themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={handleRefresh}
                title="Refresh data"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 text-gray-400 hover:text-gold transition-all hidden"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshConfig.autoRefresh && (
                  <span className="text-[10px] font-semibold text-gold/80 hidden sm:inline">
                    AUTO {refreshConfig.intervalMinutes}m
                  </span>
                )}
              </button>
              <NotificationBell />
              <UserDropdown />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
