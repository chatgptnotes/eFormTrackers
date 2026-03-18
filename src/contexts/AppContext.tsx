import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { SidebarCategory, AutoApproveRule } from '../types';
import { DEFAULT_AUTO_APPROVE_RULES } from '../services/mockData';

export type Language = 'en' | 'ar';
export type ViewRole = 'approver' | 'manager' | 'executive';
export type ThemeMode = 'dark' | 'light';

interface WatchedItem {
  id: string;
  addedAt: string;
}

interface Comment {
  id: string;
  submissionId: string;
  author: string;
  text: string;
  timestamp: string;
}

interface Delegation {
  from: string;
  to: string;
  startDate: string;
  endDate: string;
  active: boolean;
}

interface SLAConfig {
  level1Days: number;
  level2Days: number;
  level3Days: number;
  level4Days: number;
  [key: string]: number;
}

interface EscalationRule {
  id: string;
  levelDays: number;
  action: string;
  enabled: boolean;
}

interface AuditEntry {
  id: string;
  submissionId: string;
  action: string;
  actor: string;
  timestamp: string;
  details: string;
}

interface AppContextType {
  language: Language;
  setLanguage: (l: Language) => void;
  viewRole: ViewRole;
  setViewRole: (r: ViewRole) => void;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  watchlist: WatchedItem[];
  toggleWatch: (id: string) => void;
  isWatched: (id: string) => boolean;
  comments: Comment[];
  addComment: (submissionId: string, author: string, text: string) => void;
  getComments: (submissionId: string) => Comment[];
  delegations: Delegation[];
  addDelegation: (d: Omit<Delegation, 'active'>) => void;
  removeDelegation: (from: string) => void;
  slaConfig: SLAConfig;
  setSlaConfig: (c: SLAConfig) => void;
  getSLAStatus: (level: number, days: number) => 'green' | 'yellow' | 'red';
  escalationRules: EscalationRule[];
  setEscalationRules: (r: EscalationRule[]) => void;
  auditLog: AuditEntry[];
  addAuditEntry: (submissionId: string, action: string, actor: string, details: string) => void;
  selectedSubmissions: Set<string>;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  t: (key: string) => string;
  activeSidebarCategory: SidebarCategory | null;
  setActiveSidebarCategory: (cat: SidebarCategory | null) => void;
  activeWorkflowId: string | null;
  setActiveWorkflowId: (id: string | null) => void;
  autoApproveRules: AutoApproveRule[];
  setAutoApproveRules: (rules: AutoApproveRule[]) => void;
}

const translations: Record<string, Record<Language, string>> = {
  'dashboard': { en: 'Dashboard', ar: 'لوحة القيادة' },
  'workflow_tracker': { en: 'Workflow Tracker', ar: 'متتبع سير العمل' },
  'bottleneck_analysis': { en: 'Bottleneck Analysis', ar: 'تحليل الاختناقات' },
  'kanban_board': { en: 'Kanban Board', ar: 'لوحة كانبان' },
  'analytics': { en: 'Analytics', ar: 'التحليلات' },
  'settings': { en: 'Settings', ar: 'الإعدادات' },
  'total_forms': { en: 'Total Forms', ar: 'إجمالي النماذج' },
  'completed': { en: 'Completed', ar: 'مكتمل' },
  'in_progress': { en: 'In Progress', ar: 'قيد التنفيذ' },
  'stuck_7_days': { en: 'Stuck > 7 Days', ar: 'عالق > 7 أيام' },
  'stuck_30_days': { en: 'Stuck > 30 Days', ar: 'عالق > 30 يوم' },
  'rejected': { en: 'Rejected', ar: 'مرفوض' },
  'pending': { en: 'Pending', ar: 'معلق' },
  'search': { en: 'Search...', ar: 'بحث...' },
  'export_excel': { en: 'Export Excel', ar: 'تصدير إكسل' },
  'export_pdf': { en: 'Export PDF', ar: 'تصدير PDF' },
  'filters': { en: 'Filters', ar: 'فلاتر' },
  'department': { en: 'Department', ar: 'القسم' },
  'approval_level': { en: 'Approval Level', ar: 'مستوى الموافقة' },
  'status': { en: 'Status', ar: 'الحالة' },
  'sla_tracking': { en: 'SLA Tracking', ar: 'تتبع اتفاقية الخدمة' },
  'escalation': { en: 'Escalation', ar: 'التصعيد' },
  'watchlist': { en: 'Watchlist', ar: 'قائمة المراقبة' },
  'audit_trail': { en: 'Audit Trail', ar: 'سجل التدقيق' },
  'bulk_actions': { en: 'Bulk Actions', ar: 'إجراءات جماعية' },
  'dark_mode': { en: 'Dark Mode', ar: 'الوضع الداكن' },
  'language': { en: 'Language', ar: 'اللغة' },
  'approver_view': { en: 'Approver View', ar: 'عرض الموافق' },
  'manager_view': { en: 'Manager View', ar: 'عرض المدير' },
  'executive_view': { en: 'Executive View', ar: 'عرض التنفيذي' },
  'delegation': { en: 'Delegation', ar: 'التفويض' },
  'comments': { en: 'Comments', ar: 'التعليقات' },
  'priority': { en: 'Priority', ar: 'الأولوية' },
  'high': { en: 'High', ar: 'عالي' },
  'medium': { en: 'Medium', ar: 'متوسط' },
  'low': { en: 'Low', ar: 'منخفض' },
  'urgent': { en: 'Urgent', ar: 'عاجل' },
  'on_track': { en: 'On Track', ar: 'في المسار' },
  'delayed': { en: 'Delayed', ar: 'متأخر' },
  'critical': { en: 'Critical', ar: 'حرج' },
  'notifications': { en: 'Notifications', ar: 'الإشعارات' },
  'integration_status': { en: 'Integration Status', ar: 'حالة التكامل' },
  'predictive': { en: 'Predictive Analytics', ar: 'التحليلات التنبؤية' },
  'scorecards': { en: 'Department Scorecards', ar: 'بطاقات أداء الأقسام' },
  'leaderboard': { en: 'Approver Leaderboard', ar: 'لوحة متصدري الموافقين' },
  'calendar_heatmap': { en: 'Calendar Heatmap', ar: 'خريطة حرارية تقويمية' },
  'form_analytics': { en: 'Form Analytics', ar: 'تحليلات النماذج' },
  'all_departments': { en: 'All Departments', ar: 'كل الأقسام' },
  'all_levels': { en: 'All Levels', ar: 'كل المستويات' },
  'all_statuses': { en: 'All Statuses', ar: 'كل الحالات' },
  'clear_all': { en: 'Clear All', ar: 'مسح الكل' },
  'submissions': { en: 'Submissions', ar: 'المقدمات' },
  'days': { en: 'days', ar: 'أيام' },
  'avg_approval_time': { en: 'Avg Approval Time', ar: 'متوسط وقت الموافقة' },
  'backlog': { en: 'Backlog', ar: 'الأعمال المتراكمة' },
  'throughput': { en: 'Throughput', ar: 'الإنتاجية' },
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  const [viewRole, setViewRole] = useState<ViewRole>('manager');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem('themeMode') as ThemeMode) || 'light'; } catch { return 'light'; }
  });
  const [watchlist, setWatchlist] = useState<WatchedItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [slaConfig, setSlaConfig] = useState<SLAConfig>({ level1Days: 2, level2Days: 3, level3Days: 5, level4Days: 7 });
  const [escalationRules, setEscalationRules] = useState<EscalationRule[]>([
    { id: '1', levelDays: 7, action: 'Send reminder email', enabled: true },
    { id: '2', levelDays: 14, action: 'Escalate to manager', enabled: true },
    { id: '3', levelDays: 30, action: 'Escalate to director', enabled: true },
  ]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [selectedSubmissions, setSelectedSubmissions] = useState<Set<string>>(new Set());
  const [activeSidebarCategory, setActiveSidebarCategory] = useState<SidebarCategory | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [autoApproveRules, setAutoApproveRules] = useState<AutoApproveRule[]>(DEFAULT_AUTO_APPROVE_RULES);

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', themeMode === 'light');
  }, [themeMode]);

  const toggleTheme = useCallback(() => setThemeMode(p => {
    const next = p === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('themeMode', next); } catch {}
    return next;
  }), []);

  const toggleWatch = useCallback((id: string) => {
    setWatchlist(prev => {
      const exists = prev.find(w => w.id === id);
      if (exists) return prev.filter(w => w.id !== id);
      return [...prev, { id, addedAt: new Date().toISOString() }];
    });
  }, []);

  const isWatched = useCallback((id: string) => watchlist.some(w => w.id === id), [watchlist]);

  const addComment = useCallback((submissionId: string, author: string, text: string) => {
    setComments(prev => [...prev, {
      id: `CMT-${Date.now()}`,
      submissionId,
      author,
      text,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const getComments = useCallback((submissionId: string) => comments.filter(c => c.submissionId === submissionId), [comments]);

  const addDelegation = useCallback((d: Omit<Delegation, 'active'>) => {
    setDelegations(prev => [...prev.filter(x => x.from !== d.from), { ...d, active: true }]);
  }, []);

  const removeDelegation = useCallback((from: string) => {
    setDelegations(prev => prev.filter(d => d.from !== from));
  }, []);

  const getSLAStatus = useCallback((level: number, days: number): 'green' | 'yellow' | 'red' => {
    const key = `level${level}Days`;
    const limit = (slaConfig as Record<string, number>)[key] || 5;
    if (days <= limit) return 'green';
    if (days <= limit * 2) return 'yellow';
    return 'red';
  }, [slaConfig]);

  const addAuditEntry = useCallback((submissionId: string, action: string, actor: string, details: string) => {
    setAuditLog(prev => [{ id: `AUD-${Date.now()}`, submissionId, action, actor, timestamp: new Date().toISOString(), details }, ...prev]);
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedSubmissions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => setSelectedSubmissions(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelectedSubmissions(new Set()), []);

  const t = useCallback((key: string) => translations[key]?.[language] || key, [language]);

  return (
    <AppContext.Provider value={{
      language, setLanguage, viewRole, setViewRole, themeMode, toggleTheme,
      watchlist, toggleWatch, isWatched,
      comments, addComment, getComments,
      delegations, addDelegation, removeDelegation,
      slaConfig, setSlaConfig, getSLAStatus,
      escalationRules, setEscalationRules,
      auditLog, addAuditEntry,
      selectedSubmissions, toggleSelection, selectAll, clearSelection,
      t,
      activeSidebarCategory, setActiveSidebarCategory,
      activeWorkflowId, setActiveWorkflowId,
      autoApproveRules, setAutoApproveRules,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
