import React, { useState, useMemo, useCallback, useEffect, memo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Search, User, Building2, Calendar, Clock, ChevronRight, X,
  LayoutGrid, List, AlignJustify, Columns, PanelRight, CalendarDays, ChevronLeft, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { getUserConfig, isSubmissionVisible } from '../config/currentUser';
import { Submission, WorkflowTask, ApprovalEntry } from '../types';
import WorkflowDetailsSidebar from '../components/WorkflowDetailsSidebar';
import { apiFetch } from '../lib/api';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ApprovalChain({ history }: { history: ApprovalEntry[] }) {
  const acted = history.filter(h => h.status === 'approved');
  if (acted.length === 0) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {acted.map((h, i) => (
        <React.Fragment key={i}>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700">
            L{h.level} {h.approverName}
          </span>
          {i < acted.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
        </React.Fragment>
      ))}
    </div>
  );
}

type ViewMode = 'grid' | 'list' | 'compact' | 'timeline' | 'calendar' | 'masonry' | 'split';

const VIEW_OPTIONS: { mode: ViewMode; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { mode: 'grid', icon: LayoutGrid, label: 'Grid' },
  { mode: 'list', icon: List, label: 'List' },
  { mode: 'compact', icon: AlignJustify, label: 'Compact' },
  { mode: 'timeline', icon: Clock, label: 'Timeline' },
  { mode: 'calendar', icon: CalendarDays, label: 'Calendar' },
  { mode: 'masonry', icon: Columns, label: 'Masonry' },
  { mode: 'split', icon: PanelRight, label: 'Split' },
];

function getLastApprover(sub: Submission) {
  return [...(sub.approvalHistory || [])].reverse().find(h => h.status === 'approved');
}

interface CardProps {
  submission: Submission;
  idx: number;
  onClick: (sub: Submission) => void;
}

const CompletedCard = memo(function CompletedCard({ submission, idx, onClick }: CardProps) {
  const lastApprover = getLastApprover(submission);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: idx * 0.05 }}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
      onClick={() => onClick(submission)}
      className="group relative overflow-hidden rounded-2xl p-6 border-2 border-emerald-400 hover:border-emerald-500 bg-white transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg"
    >
      <div className="relative z-10 space-y-3">
        <div>
          <p className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-1">
            {submission.formTitle || 'Form Submission'}
          </p>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-black text-black font-mono">ID: {submission.id.slice(0, 8).toUpperCase()}</p>
            <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r from-emerald-400 to-green-500">Completed</span>
          </div>
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200">
          <User className="w-4 h-4 text-gray-700" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-800 font-medium">Submitted By</p>
            <p className="text-sm font-bold text-black truncate">{submission.submittedBy.name}</p>
            <p className="text-xs text-gray-500 truncate">{submission.submittedBy.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200 bg-emerald-50 px-3 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-900 font-medium">Final Approver</p>
            <p className="text-sm font-bold text-black truncate">{lastApprover?.approverName || '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Department</p><p className="font-bold text-black">{submission.submittedBy.department || '—'}</p></div>
          <div><p className="text-gray-900 font-medium">Duration</p><p className="font-bold text-black">{submission.totalDaysSinceSubmission ?? submission.daysAtCurrentLevel ?? 0}d</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Submitted</p><p className="font-bold text-black">{formatDate(submission.submissionDate)}</p></div>
          <div><p className="text-gray-900 font-medium">Approval Chain</p><ApprovalChain history={submission.approvalHistory || []} /></div>
        </div>
        <div className="pt-2 border-t border-gray-200">
          <motion.button
            whileHover={{ x: 4 }}
            onClick={(e) => { e.stopPropagation(); onClick(submission); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-emerald-400 to-green-500 text-white font-semibold text-sm transition-all hover:shadow-lg"
          >
            <span>View Details</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
});

// ─── Calendar helpers ────────────────────────────────────────────────────────

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);
  return { days, monthName: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CompletedPage({ data }: Props) {
  const { user, orgRole } = useAuth();
  const { activeWorkflowId } = useApp();
  const currentUser = getUserConfig(user?.email);

  const [search, setSearch] = useState('');
  const [sidebarSubmission, setSidebarSubmission] = useState<Submission | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<WorkflowTask[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowCache, setWorkflowCache] = useState<Map<string, WorkflowTask[]>>(new Map());
  const [viewSignature, setViewSignature] = useState<{ url: string; approver: string; level: number } | null>(null);
  const [sigLoading, setSigLoading] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [splitSelected, setSplitSelected] = useState<Submission | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const completedSubmissions = useMemo(() => {
    return data.allSubmissions.filter(s =>
      s.currentApprovalLevel === 'completed' &&
      (!activeWorkflowId || s.formId === activeWorkflowId) &&
      isSubmissionVisible(s, user?.email, currentUser, orgRole)
    );
  }, [data.allSubmissions, activeWorkflowId, user?.email, currentUser, orgRole]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return completedSubmissions;
    return completedSubmissions.filter(s =>
      s.formTitle?.toLowerCase().includes(q) ||
      s.id?.toLowerCase().includes(q) ||
      s.submittedBy.name?.toLowerCase().includes(q) ||
      s.submittedBy.department?.toLowerCase().includes(q)
    );
  }, [completedSubmissions, search]);

  const openSidebarWithTasks = useCallback(async (sub: Submission) => {
    setSidebarSubmission(sub);
    setSplitSelected(sub);
    if (workflowCache.has(sub.id)) {
      setExpandedTasks(workflowCache.get(sub.id) || []);
      return;
    }
    // DB-first: use the workflow_tasks column already on the submission row.
    if (sub.workflowTasks && sub.workflowTasks.length > 0) {
      setExpandedTasks(sub.workflowTasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, sub.workflowTasks!));
      return;
    }
    setWorkflowLoading(true);
    try {
      const url = `/api/workflow-tasks?submissionId=${sub.id}${sub.workflowInstanceId ? `&workflowInstanceId=${sub.workflowInstanceId}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { setWorkflowLoading(false); return; }
      const json = await res.json();
      const tasks = json.tasks || [];
      setExpandedTasks(tasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, tasks));
    } catch {
      setExpandedTasks([]);
    } finally {
      setWorkflowLoading(false);
    }
  }, [workflowCache]);

  const fetchAndShowSignature = useCallback(async (submissionId: string, level: number, taskId: string) => {
    setSigLoading(taskId);
    try {
      const sigData = await apiFetch<{ signature_url?: string; approver_name?: string } | null>(
        `/api/signatures?submission_id=${submissionId}&level=${level}`
      );
      if (sigData?.signature_url) {
        setViewSignature({ url: sigData.signature_url, approver: sigData.approver_name || 'Unknown', level });
      }
    } catch { /* ignore */ }
    finally { setSigLoading(undefined); }
  }, []);

  // Pre-fetch DISABLED — was firing /api/workflow-tasks per filtered submission
  // (often 50+ at once), flooding the network with serial JotForm calls.
  // Tasks now load on-demand when the user opens a workflow detail.

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const currentView = VIEW_OPTIONS.find(v => v.mode === viewMode) || VIEW_OPTIONS[0];
  const CurrentIcon = currentView.icon;

  // Calendar data
  const calSubmissionsByDay = useMemo(() => {
    const map = new Map<number, Submission[]>();
    filtered.forEach(s => {
      if (!s.submissionDate) return;
      const d = new Date(s.submissionDate);
      if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
        const day = d.getDate();
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push(s);
      }
    });
    return map;
  }, [filtered, calYear, calMonth]);

  const { days, monthName } = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth]);

  // ── RENDER ──────────────────────────────────────────────────────────────────

  const renderEmpty = () => (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400">
      <CheckCircle2 className="w-12 h-12 mb-3 opacity-25" />
      <p className="text-sm font-medium">{search ? 'No results found' : 'No completed workflows yet'}</p>
    </div>
  );

  const renderGrid = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      <AnimatePresence>
        {filtered.map((sub, idx) => (
          <CompletedCard key={sub.id} submission={sub} idx={idx} onClick={openSidebarWithTasks} />
        ))}
      </AnimatePresence>
    </motion.div>
  );

  const renderList = () => (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest w-12">#</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Title / Form</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Submitted By</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Department</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Final Approver</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Duration</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filtered.map((sub, idx) => {
                const la = getLastApprover(sub);
                return (
                  <motion.tr key={sub.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ delay: idx * 0.02 }}
                    onClick={() => openSidebarWithTasks(sub)} className="border-b border-gray-50 hover:bg-emerald-50/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 text-sm text-gray-400 font-mono">{idx + 1}</td>
                    <td className="px-4 py-3"><div><p className="text-sm font-semibold text-gray-900 truncate max-w-[220px]">{sub.formTitle || 'Form Submission'}</p><p className="text-xs font-mono text-emerald-600">{sub.id.slice(0, 8).toUpperCase()}</p></div></td>
                    <td className="px-4 py-3"><p className="text-sm font-medium text-gray-800">{sub.submittedBy.name}</p><p className="text-xs text-gray-400 truncate max-w-[160px]">{sub.submittedBy.email}</p></td>
                    <td className="px-4 py-3 text-sm text-gray-700">{sub.submittedBy.department || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-800 font-medium">{la?.approverName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(sub.submissionDate)}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><Clock className="w-3 h-3" />{sub.totalDaysSinceSubmission ?? sub.daysAtCurrentLevel ?? 0}d</span></td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderCompact = () => (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider w-8">#</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Form / Dept</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Submitted By</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Approver</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider w-12">Days</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filtered.map((sub, idx) => {
                const la = getLastApprover(sub);
                return (
                  <motion.tr key={sub.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.01 }}
                    onClick={() => openSidebarWithTasks(sub)} className="border-b border-gray-50 hover:bg-emerald-50/50 transition-colors cursor-pointer">
                    <td className="px-2 py-1 text-xs text-gray-400 font-mono">{idx + 1}</td>
                    <td className="px-2 py-1"><p className="text-xs font-semibold text-gray-900 truncate max-w-[180px]">{sub.formTitle || '—'}</p><p className="text-[10px] text-gray-400">{sub.submittedBy.department || '—'}</p></td>
                    <td className="px-2 py-1"><p className="text-xs text-gray-800 truncate max-w-[120px]">{sub.submittedBy.name}</p></td>
                    <td className="px-2 py-1 text-xs text-gray-700 truncate max-w-[120px]">{la?.approverName || '—'}</td>
                    <td className="px-2 py-1 text-xs text-gray-500">{formatDate(sub.submissionDate)}</td>
                    <td className="px-2 py-1 text-xs text-emerald-600 font-medium">{sub.totalDaysSinceSubmission ?? sub.daysAtCurrentLevel ?? 0}d</td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTimeline = () => (
    <div className="relative pl-8 border-l-2 border-emerald-200 ml-4 space-y-0">
      <AnimatePresence>
        {filtered.map((sub, idx) => {
          const la = getLastApprover(sub);
          const steps = (sub.approvalHistory || []).filter(h => h.status === 'approved').length;
          return (
            <motion.div key={sub.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ delay: idx * 0.03 }}
              onClick={() => openSidebarWithTasks(sub)}
              className="relative pb-6 cursor-pointer group"
            >
              <div className="absolute -left-[28px] top-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white shadow group-hover:scale-125 transition-transform" />
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:border-emerald-300 transition-all ml-2">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{sub.formTitle || 'Form Submission'}</p>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(sub.submissionDate)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> {sub.submittedBy.name}</span>
                  <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {sub.submittedBy.department || '—'}</span>
                  <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> {la?.approverName || '—'}</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  {Array.from({ length: Math.min(steps, 5) }).map((_, i) => (
                    <div key={i} className="w-5 h-1 rounded-full bg-emerald-300" />
                  ))}
                  <span className="text-[10px] text-gray-400 ml-1">{steps} step{steps !== 1 ? 's' : ''}</span>
                  <span className="text-[10px] text-emerald-500 ml-auto font-medium">{sub.totalDaysSinceSubmission ?? sub.daysAtCurrentLevel ?? 0}d total</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  const renderCalendar = () => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border-b border-emerald-100">
        <button onClick={() => calMonth === 0 ? (setCalMonth(11), setCalYear(y => y - 1)) : setCalMonth(m => m - 1)} className="p-1 rounded hover:bg-emerald-200 transition-colors"><ChevronLeft className="w-4 h-4 text-emerald-700" /></button>
        <h3 className="text-sm font-semibold text-emerald-800">{monthName}</h3>
        <button onClick={() => calMonth === 11 ? (setCalMonth(0), setCalYear(y => y + 1)) : setCalMonth(m => m + 1)} className="p-1 rounded hover:bg-emerald-200 transition-colors"><ChevronRight className="w-4 h-4 text-emerald-700" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const subs = day ? calSubmissionsByDay.get(day) || [] : [];
          const isToday = day === new Date().getDate() && calMonth === new Date().getMonth() && calYear === new Date().getFullYear();
          return (
            <div key={i} className={`min-h-[80px] border-b border-r border-gray-50 p-1.5 ${!day ? 'bg-gray-50/50' : 'hover:bg-emerald-50/30 cursor-pointer transition-colors'} ${isToday ? 'bg-emerald-50/50 ring-1 ring-inset ring-emerald-300' : ''}`}>
              {day && <p className={`text-xs font-medium mb-0.5 ${isToday ? 'text-emerald-700' : 'text-gray-500'}`}>{day}</p>}
              <div className="space-y-0.5">
                {subs.slice(0, 3).map(s => (
                  <div key={s.id} onClick={() => openSidebarWithTasks(s)} className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate hover:bg-emerald-200 transition-colors" title={s.formTitle}>
                    {s.formTitle?.slice(0, 18) || s.id.slice(0, 6)}
                  </div>
                ))}
                {subs.length > 3 && <p className="text-[9px] text-gray-400 pl-1">+{subs.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMasonry = () => (
    <div className="columns-1 md:columns-2 lg:columns-3 gap-5 space-y-5">
      <AnimatePresence>
        {filtered.map((sub, idx) => {
          const la = getLastApprover(sub);
          return (
            <motion.div key={sub.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: idx * 0.03 }}
              whileHover={{ y: -4 }} onClick={() => openSidebarWithTasks(sub)}
              className="break-inside-avoid bg-white rounded-xl border border-gray-200 p-5 cursor-pointer shadow-sm hover:shadow-md hover:border-emerald-300 transition-all"
            >
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{sub.formTitle || 'Form Submission'}</p>
              <p className="text-xs font-mono text-emerald-600 mb-2">{sub.id.slice(0, 8).toUpperCase()}</p>
              <div className="flex items-center gap-2 py-2 border-t border-gray-100 text-xs">
                <User className="w-3.5 h-3.5 text-gray-400" />
                <span className="font-medium text-gray-700">{sub.submittedBy.name}</span>
              </div>
              <div className="flex items-center gap-2 py-2 border-t border-gray-100 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-gray-700">{la?.approverName || '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100 text-xs">
                <span className="text-gray-400">{formatDate(sub.submissionDate)}</span>
                <span className="font-medium text-emerald-600">{sub.totalDaysSinceSubmission ?? sub.daysAtCurrentLevel ?? 0}d</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  const renderSplit = () => {
    const selected = splitSelected || filtered[0];
    const la = selected ? getLastApprover(selected) : null;
    return (
      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {/* Left: compact list */}
        <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{filtered.length} submissions</div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map((sub, idx) => (
              <div key={sub.id}
                onClick={() => openSidebarWithTasks(sub)}
                className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${splitSelected?.id === sub.id ? 'bg-emerald-50 border-l-2 border-l-emerald-400' : 'hover:bg-gray-50'}`}
              >
                <p className="text-xs font-semibold text-gray-900 truncate">{sub.formTitle || '—'}</p>
                <p className="text-[10px] text-gray-400 truncate">{sub.submittedBy.name} · {formatDate(sub.submissionDate)}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Right: detail card */}
        {selected && (
          <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 overflow-y-auto">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r from-emerald-400 to-green-500">Completed</span>
              <p className="text-xs text-gray-400 font-mono">{selected.id.slice(0, 8).toUpperCase()}</p>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">{selected.formTitle || 'Form Submission'}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Submitted By</p><p className="font-semibold text-gray-800">{selected.submittedBy.name}</p><p className="text-xs text-gray-500">{selected.submittedBy.email}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Department</p><p className="font-semibold text-gray-800">{selected.submittedBy.department || '—'}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Final Approver</p><p className="font-semibold text-gray-800">{la?.approverName || '—'}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Duration</p><p className="font-semibold text-emerald-600">{selected.totalDaysSinceSubmission ?? selected.daysAtCurrentLevel ?? 0} days</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Submitted</p><p className="font-semibold text-gray-800">{formatDate(selected.submissionDate)}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Approval Chain</p><ApprovalChain history={selected.approvalHistory || []} /></div>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <motion.button whileHover={{ x: 4 }} onClick={() => openSidebarWithTasks(selected)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-400 to-green-500 text-white font-semibold text-sm hover:shadow-lg transition-all"
              >
                <span>View Full Details</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </motion.button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Main Return ─────────────────────────────────────────────────────────────

  const mainContent = (() => {
    if (filtered.length === 0) return renderEmpty();
    switch (viewMode) {
      case 'grid': return renderGrid();
      case 'list': return renderList();
      case 'compact': return renderCompact();
      case 'timeline': return renderTimeline();
      case 'calendar': return renderCalendar();
      case 'masonry': return renderMasonry();
      case 'split': return renderSplit();
    }
  })();

  return (
    <div className="relative w-full min-h-screen">
      <div className={`space-y-6 w-full transition-all duration-300 ${sidebarSubmission ? 'md:pr-[620px]' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <h1 className="text-xl font-bold text-gray-900">Completed Requests</h1>
            </div>
            <p className="text-sm text-gray-500">{completedSubmissions.length} workflow{completedSubmissions.length !== 1 ? 's' : ''} fully completed</p>
          </div>
          {/* View Switcher Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-emerald-300 hover:text-emerald-600 transition-colors shadow-sm"
            >
              <CurrentIcon className="w-4 h-4" />
              <span>{currentView.label}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-1 overflow-hidden"
                >
                  {VIEW_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    const active = viewMode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        onClick={() => { setViewMode(opt.mode); setDropdownOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          active ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{opt.label}</span>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by form, ID, name, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
          />
        </div>

        {/* Main Content Area */}
        {mainContent}
      </div>

      {/* Right Sidebar */}
      <WorkflowDetailsSidebar
        isOpen={!!sidebarSubmission}
        submission={sidebarSubmission}
        expandedTasks={expandedTasks}
        expandLoading={workflowLoading ? sidebarSubmission?.id : undefined}
        user={user}
        showOverlay={false}
        isAbsolute={true}
        onClose={() => setSidebarSubmission(null)}
        onFetchSignature={fetchAndShowSignature}
        sigLoading={sigLoading}
      />

      {/* Signature Viewer Modal */}
      <AnimatePresence>
        {viewSignature && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setViewSignature(null)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl overflow-hidden w-full max-w-sm sm:max-w-md shadow-2xl">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Signature</h3>
                <button onClick={() => setViewSignature(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-4 text-center">
                <p className="text-xs text-gray-500 mb-3">L{viewSignature.level} — {viewSignature.approver}</p>
                <img src={viewSignature.url} alt="Signature" className="max-w-full mx-auto rounded-lg border border-gray-200" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
