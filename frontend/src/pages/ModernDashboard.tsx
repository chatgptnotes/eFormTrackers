import React, { useState, useMemo, useTransition, useDeferredValue, useCallback, memo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Search, AlertCircle, CheckCircle2, Clock, Zap, ExternalLink, User, Calendar,
  FileText, Briefcase, Download, ArrowUpDown, LayoutGrid, List, AlignJustify, Columns,
  PanelRight, CalendarDays, ChevronLeft, ChevronDown, Building2, X, Filter,
} from 'lucide-react';
import SubmissionModal from '../components/SubmissionModal';
import WorkflowDetailsModal from '../components/WorkflowDetailsModal';
import WorkflowDetailsSidebar from '../components/WorkflowDetailsSidebar';
import { Skeleton, SkeletonStatCard, SkeletonSubmissionCard } from '../components/Skeleton';
import { Submission, WorkflowTask } from '../types';
import { getMyWorkflowRole, isAwaitingMyAction, getMyActionType } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { exportToExcel } from '../services/exportService';
import { apiFetch } from '../lib/api';

interface Props {
  data: ReturnType<typeof import('../hooks/useSubmissions').useSubmissions>;
}

const statusConfig = {
  pending: { color: 'from-cyan-400 to-sky-400', icon: Clock, label: 'Pending', text: 'text-white', bgLight: 'bg-cyan-400/20', iconColor: 'text-cyan-300' },
  approved: { color: 'from-blue-400 to-blue-600', icon: CheckCircle2, label: 'Approved', text: 'text-white', bgLight: 'bg-blue-500/20', iconColor: 'text-blue-300' },
  rejected: { color: 'from-red-500 to-rose-600', icon: AlertCircle, label: 'Rejected', text: 'text-white', bgLight: 'bg-red-500/20', iconColor: 'text-red-300' },
  completed: { color: 'from-cyan-300 to-blue-400', icon: Zap, label: 'Completed', text: 'text-white', bgLight: 'bg-cyan-400/20', iconColor: 'text-cyan-200' },
};

function getSubmissionStatus(submission: Submission): keyof typeof statusConfig {
  if (submission.currentApprovalLevel === 'completed') return 'completed';
  if (submission.currentApprovalLevel === 'rejected') return 'rejected';
  const hasPending = submission.approvalHistory.some(a => a.status === 'pending');
  if (hasPending) return 'pending';
  const lastEntry = submission.approvalHistory[submission.approvalHistory.length - 1];
  if (lastEntry?.status === 'approved') return 'approved';
  if (lastEntry?.status === 'rejected') return 'rejected';
  return 'pending';
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getLastApprover(sub: Submission) {
  return [...(sub.approvalHistory || [])].reverse().find(h => h.status === 'approved');
}

// Treat synthetic placeholders ("Approver", "Level N Approver") as no real assignee.
function displayApproverName(name: string | null | undefined, fallback = '—'): string {
  const v = (name || '').trim();
  if (!v) return fallback;
  if (v === 'Approver' || /^Level \d+ Approver$/.test(v)) return fallback;
  return v;
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);
  return { days, monthName: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
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

interface SubmissionCardProps {
  submission: Submission;
  idx: number;
  user: ReturnType<typeof import('../contexts/AuthContext').useAuth>['user'];
  onViewDetails: (submission: Submission) => void;
  onOpenModal: (submission: Submission) => void;
}

interface StatCardProps {
  label: string;
  value: number | string;
  trend: string;
  color: string;
  idx: number;
}

const StatCard = memo(function StatCard({ label, value, trend, color, idx }: StatCardProps) {
  const borderColorMap: Record<number, string> = {
    0: 'border-blue-500', 1: 'border-cyan-400', 2: 'border-blue-400', 3: 'border-indigo-400',
  };
  const bgColorMap: Record<number, string> = {
    0: 'bg-blue-50', 1: 'bg-cyan-50', 2: 'bg-blue-50', 3: 'bg-indigo-50',
  };
  const textColorMap: Record<number, string> = {
    0: 'text-blue-700', 1: 'text-cyan-700', 2: 'text-blue-700', 3: 'text-indigo-700',
  };
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }}
      className={`group relative overflow-hidden rounded-2xl p-6 border-2 transition-all duration-300 cursor-pointer shadow-md hover:shadow-xl hover:border-opacity-80 ${borderColorMap[idx % 4]}`}
      style={{ background: '#ffffff' }}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border backdrop-blur-sm ${textColorMap[idx % 4]} ${bgColorMap[idx % 4]} ${borderColorMap[idx % 4]}`}>{trend}</span>
        </div>
        <p className="text-gray-700 text-xs font-semibold uppercase tracking-wider mb-2">{label}</p>
        <div className="flex items-baseline gap-2"><span className="text-3xl md:text-4xl font-black text-black">{value}</span></div>
      </div>
    </motion.div>
  );
});

const SubmissionCard = memo(function SubmissionCard({ submission, idx, user, onViewDetails, onOpenModal }: SubmissionCardProps) {
  const status = getSubmissionStatus(submission);
  const sc = statusConfig[status];
  const StatusIcon = sc.icon;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: idx * 0.05 }}
      onClick={() => onOpenModal(submission)}
      className={`group relative overflow-hidden rounded-2xl p-6 border-2 transition-all duration-300 cursor-pointer shadow-md hover:shadow-xl ${status === 'pending' ? 'border-cyan-400 hover:border-cyan-500' : status === 'approved' ? 'border-blue-400 hover:border-blue-500' : status === 'rejected' ? 'border-red-400 hover:border-red-500' : 'border-cyan-300 hover:border-cyan-400'}`}
      style={{ background: '#ffffff' }}
    >
      <div className="relative z-10 space-y-3">
        <div>
          <p className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-1">{submission.formTitle || 'Form Submission'}</p>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1"><p className="text-sm font-black text-black font-mono">ID: {submission.id.slice(0, 8).toUpperCase()}</p></div>
            <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r ${sc.color}`}>{sc.label}</span>
          </div>
          {(() => {
            const myRole = getMyWorkflowRole(submission, user?.email);
            return myRole ? <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">You: {myRole}</span> : null;
          })()}
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200">
          <User className="w-4 h-4 text-gray-700" />
          <div className="flex-1 min-w-0"><p className="text-xs text-gray-800 font-medium">Submitted By</p><p className="text-sm font-bold text-black truncate">{submission.submittedBy.name}</p><p className="text-xs text-gray-500 truncate">{submission.submittedBy.email}</p></div>
        </div>
        <div className="flex items-center gap-2 py-2 border-t border-gray-200 bg-blue-50 px-3 rounded-lg">
          <Briefcase className="w-4 h-4 text-blue-700 flex-shrink-0" />
          <div className="flex-1 min-w-0"><p className="text-xs text-gray-900 font-medium">Pending With</p>{(() => {
            const resolved = displayApproverName(submission.pendingApproverName, '');
            return resolved
              ? <p className="text-sm font-bold text-black truncate">{resolved}</p>
              : <p className="text-sm font-medium text-gray-400 italic truncate">Not assigned</p>;
          })()}{submission.pendingApproverEmail && <p className="text-xs text-gray-500 truncate">{submission.pendingApproverEmail}</p>}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Department</p><p className="font-bold text-black">{submission.submittedBy.department || '—'}</p></div>
          <div><p className="text-gray-900 font-medium">Priority</p><p className={`font-bold text-sm ${submission.priority === 'urgent' ? 'text-red-600' : submission.priority === 'high' ? 'text-orange-600' : submission.priority === 'medium' ? 'text-yellow-600' : 'text-green-600'}`}>{submission.priority?.toUpperCase() || '—'}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-200 text-xs">
          <div><p className="text-gray-900 font-medium">Submitted</p><p className="font-bold text-black">{new Date(submission.submissionDate).toLocaleDateString()}</p></div>
          <div><p className="text-gray-900 font-medium">Pending For</p><p className={`font-bold text-sm ${submission.daysAtCurrentLevel > 14 ? 'text-red-600' : submission.daysAtCurrentLevel > 7 ? 'text-orange-600' : 'text-gray-900'}`}>{submission.daysAtCurrentLevel || 0} days</p></div>
        </div>
        <div className="pt-2 border-t border-gray-200 space-y-2">
          {(() => {
            // CTA reflects MY actual active task type — not a blanket "Review &
            // Approve". Approval opens the signature modal; Task/Form open the
            // workflow sidebar where the correct external link lives.
            const btnClass = `w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r ${sc.color} text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent`;
            const myAction = getMyActionType(submission, user?.email);
            if (myAction === 'approval') {
              return <motion.button whileHover={{ scale: 1.02 }} onClick={() => onViewDetails(submission)} className={btnClass}><CheckCircle2 className="w-4 h-4" /><span>Review &amp; Approve</span></motion.button>;
            }
            if (myAction === 'form') {
              return <motion.button whileHover={{ scale: 1.02 }} onClick={(e) => { e.stopPropagation(); onOpenModal(submission); }} className={btnClass}><FileText className="w-4 h-4" /><span>Fill Form</span></motion.button>;
            }
            if (myAction === 'task') {
              return <motion.button whileHover={{ scale: 1.02 }} onClick={(e) => { e.stopPropagation(); onOpenModal(submission); }} className={btnClass}><ExternalLink className="w-4 h-4" /><span>Open Task</span></motion.button>;
            }
            return <motion.button whileHover={{ x: 4 }} onClick={(e) => { e.stopPropagation(); onOpenModal(submission); }} className={`${btnClass} group/btn`}><span>View Details</span><span className="group-hover/btn:translate-x-1 transition-transform">→</span></motion.button>;
          })()}
        </div>
      </div>
    </motion.div>
  );
});

export default function ModernDashboard({ data }: Props) {
  const { allSubmissions: rawSubmissions, loading, error } = data;
  const { user } = useAuth();
  const { activeWorkflowId } = useApp();

  // Personal action queue (no role bypass, same for every user): ONLY submissions
  // awaiting MY action right now — the current pending approver or an ACTIVE task
  // (incl. parallel-approval steps). Completed/rejected workflows do NOT appear
  // here; they live on the dedicated Completed page. Drives stat cards + views.
  const allSubmissions = useMemo(
    () => rawSubmissions.filter(s => isAwaitingMyAction(s, user?.email)),
    [rawSubmissions, user?.email],
  );

  const [isPending, startTransition] = useTransition();
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [workflowModalSubmission, setWorkflowModalSubmission] = useState<Submission | null>(null);
  const [workflowSidebarSubmission, setWorkflowSidebarSubmission] = useState<Submission | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<WorkflowTask[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowCache, setWorkflowCache] = useState<Map<string, WorkflowTask[]>>(new Map());
  const [viewSignature, setViewSignature] = useState<{ url: string; approver: string; level: number; allUrls: string[]; submissionId: string } | null>(null);
  const [sigLoading, setSigLoading] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'days'>('latest');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [splitSelected, setSplitSelected] = useState<Submission | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const [showFilters, setShowFilters] = useState(false);
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSubmittedBy, setFilterSubmittedBy] = useState('');

  const uniqueDepartments = useMemo(
    () => Array.from(new Set(allSubmissions.map(s => s.submittedBy.department).filter(Boolean) as string[])).sort(),
    [allSubmissions],
  );
  const uniqueSubmitters = useMemo(
    () => Array.from(new Set(allSubmissions.map(s => s.submittedBy.name).filter(Boolean) as string[])).sort(),
    [allSubmissions],
  );
  const activeFilterCount = [filterDepartment, filterDateFrom, filterDateTo, filterSubmittedBy].filter(Boolean).length;
  const clearAllFilters = () => {
    setFilterDepartment('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterSubmittedBy('');
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredAndSortedSubmissions = useMemo(() => {
    const dateFromTs = filterDateFrom ? new Date(filterDateFrom).getTime() : null;
    const dateToTs = filterDateTo ? new Date(filterDateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    let filtered = allSubmissions
      .filter(sub => !activeWorkflowId || sub.formId === activeWorkflowId)
      .filter(sub => !sub.formTitle.includes('Workflow Form'))
      .filter(sub => {
        const matchesSearch = sub.id.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
          sub.submittedBy.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
          sub.formTitle.toLowerCase().includes(deferredSearchQuery.toLowerCase());
        const status = getSubmissionStatus(sub);
        const matchesStatus = filterStatus === 'all' || status === filterStatus;
        const matchesDept = !filterDepartment || sub.submittedBy.department === filterDepartment;
        const matchesSubmitter = !filterSubmittedBy || sub.submittedBy.name === filterSubmittedBy;
        const submittedTs = sub.submissionDate ? new Date(sub.submissionDate).getTime() : 0;
        const matchesDateFrom = dateFromTs === null || submittedTs >= dateFromTs;
        const matchesDateTo = dateToTs === null || submittedTs <= dateToTs;
        return matchesSearch && matchesStatus && matchesDept && matchesSubmitter && matchesDateFrom && matchesDateTo;
      });
    if (sortBy === 'latest') filtered.sort((a, b) => new Date(b.submissionDate).getTime() - new Date(a.submissionDate).getTime());
    else if (sortBy === 'oldest') filtered.sort((a, b) => new Date(a.submissionDate).getTime() - new Date(b.submissionDate).getTime());
    else if (sortBy === 'days') filtered.sort((a, b) => b.daysAtCurrentLevel - a.daysAtCurrentLevel);
    return filtered;
  }, [allSubmissions, activeWorkflowId, deferredSearchQuery, filterStatus, sortBy, filterDepartment, filterDateFrom, filterDateTo, filterSubmittedBy]);

  const totalPages = Math.ceil(filteredAndSortedSubmissions.length / itemsPerPage);
  const paginatedSubmissions = filteredAndSortedSubmissions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleExport = useCallback(() => { exportToExcel(filteredAndSortedSubmissions, 'Modern Dashboard Data'); }, [filteredAndSortedSubmissions]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => { setSearchQuery(e.target.value); setCurrentPage(1); });
  }, []);

  const handleStatusFilter = useCallback((status: string) => {
    startTransition(() => { setFilterStatus(status); setCurrentPage(1); });
  }, []);

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    startTransition(() => { setSortBy(e.target.value as 'latest' | 'oldest' | 'days'); setCurrentPage(1); });
  }, []);

  const handleViewDetails = useCallback((submission: Submission) => { setSelectedSubmission(submission); }, []);

  // Right-sidebar Approve/Reject route through the same approve-&-sign modal the
  // cards use. Open Task / Fill Form resolves the access-token URL server-side.
  const openSidebarApproveModal = useCallback(() => {
    if (workflowSidebarSubmission) setSelectedSubmission(workflowSidebarSubmission);
  }, [workflowSidebarSubmission]);

  const openTaskLink = useCallback(async (task: WorkflowTask) => {
    // Synchronous open keeps the click as a "user gesture" so popup blockers
    // don't suppress the new tab. CRITICAL: do NOT pass 'noopener'/'noreferrer'
    // here — they force window.open to return null, leaving the placeholder
    // tab stuck at about:blank. We sever pop.opener AFTER navigation instead.
    const pop = window.open('about:blank', '_blank');
    const sub = workflowSidebarSubmission;
    let url = '';
    let reason = '';
    if (sub) {
      try {
        const json = await apiFetch<{ approvalUrl?: string | null; reason?: string; error?: string }>(
          `/api/email-url?formId=${sub.formId}&submissionId=${sub.id}`,
          { throwOnError: false },
        );
        if (json?.approvalUrl) url = json.approvalUrl;
        else reason = json?.reason || json?.error || 'no url returned';
      } catch (e) {
        reason = (e as Error)?.message || String(e);
      }
    }
    if (!url && task.accessLink) url = task.accessLink;

    if (!url) {
      if (pop && !pop.closed) pop.close();
      // eslint-disable-next-line no-console
      console.warn('[openTaskLink] no URL resolved:', { reason, taskId: task.taskId, type: task.type });
      alert(`Couldn't open the JotForm task: ${reason || 'this step has no accessible link'}`);
      return;
    }

    if (pop && !pop.closed) {
      try {
        pop.location.href = url;
        // Sever opener now that we've redirected — same security as noopener
        // would have given us up front, but compatible with the sync-open trick.
        try { pop.opener = null; } catch { /* cross-origin once navigated */ }
      } catch {
        pop.close();
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else {
      // Popup was blocked at the OS level. Open a fresh one anyway — most browsers
      // still honor user-initiated calls if the first one was suppressed.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [workflowSidebarSubmission]);

  const fetchAndShowSignature = useCallback(async (submissionId: string, level: number, taskId: string) => {
    setSigLoading(taskId);
    try {
      // Find the SPECIFIC submission the user clicked from in-memory state.
      // Every URL extracted below comes from THAT submission's answers JSONB
      // (mapped from jf_submissions.answers DB column) — never hardcoded,
      // never reused across different submissions.
      const sub = data.allSubmissions.find((s) => s.id === submissionId);
      if (!sub) {
        console.warn('[signature] submission not found in cache:', submissionId);
        setSigLoading(undefined);
        return;
      }
      // Form-field signatures (control_signature) live in answers.
      const answerSigs: string[] = sub.answers
        ? Object.values(sub.answers).filter(
            (v): v is string =>
              typeof v === 'string' &&
              v.toLowerCase().includes('signature') &&
              /\.(png|jpe?g)$/i.test(v)
          )
        : [];
      // Approval-step signatures (approver signed while approving) live in
      // workflowTasks[].signatureUrl — captured server-side during sync.
      const taskSigs: string[] = (sub.workflowTasks || [])
        .map((t) => t.signatureUrl)
        .filter((u): u is string => typeof u === 'string' && /\.(png|jpe?g)$/i.test(u));
      const sigUrls = Array.from(new Set([...answerSigs, ...taskSigs]));
      console.log(`[signature] submission ${submissionId} (level ${level}): ${answerSigs.length} form-field + ${taskSigs.length} approval-step signature(s)`, sigUrls);
      if (sigUrls.length > 0) {
        // Pass ALL URLs found so the modal can show them as a list (user picks).
        // matched = best guess for the clicked level (field-id suffix match).
        const matched = sigUrls.find((u) => u.match(new RegExp(`signature_${level}\\.`))) || sigUrls[0];
        const approver = sub.approvalHistory?.find((h) => h.level === level)?.approverName
          || sub.pendingApproverName
          || 'Approver';
        setViewSignature({ url: matched, approver, level, allUrls: sigUrls, submissionId });
        return;
      }
      // Fallback: legacy /api/signatures (jf_signatures table — for the 4 rows
      // captured by in-app SignaturePad approvals, not JotForm signatures).
      const apiData = await apiFetch<{ signature_url?: string; approver_name?: string } | null>(
        `/api/signatures?submission_id=${submissionId}&level=${level}`
      );
      if (apiData?.signature_url) {
        setViewSignature({ url: apiData.signature_url, approver: apiData.approver_name || 'Unknown', level, allUrls: [apiData.signature_url], submissionId });
      } else {
        // Nothing in DB. Tell the user explicitly instead of silently doing nothing.
        setViewSignature({ url: '', approver: 'No signature data', level, allUrls: [], submissionId });
      }
    } catch (err) { console.warn('Failed to fetch signature:', err); }
    finally { setSigLoading(undefined); }
  }, [data.allSubmissions]);

  const openSidebarWithTasks = async (sub: Submission) => {
    setWorkflowSidebarSubmission(sub);
    setSplitSelected(sub);
    if (workflowCache.has(sub.id)) { setExpandedTasks(workflowCache.get(sub.id) || []); return; }
    // DB-first: if the submission row already carries workflow_tasks (populated
    // server-side during sync), use it. No network call.
    if (sub.workflowTasks && sub.workflowTasks.length > 0) {
      setExpandedTasks(sub.workflowTasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, sub.workflowTasks!));
      return;
    }
    // Fallback only when DB is missing the data — single on-demand fetch.
    setWorkflowLoading(true);
    try {
      const url = `/api/workflow-tasks?submissionId=${sub.id}${sub.workflowInstanceId ? `&workflowInstanceId=${sub.workflowInstanceId}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { setWorkflowLoading(false); return; }
      const json = await res.json();
      const tasks = json.tasks || [];
      setExpandedTasks(tasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, tasks));
    } catch { setExpandedTasks([]); }
    finally { setWorkflowLoading(false); }
  };

  // Pre-fetch DISABLED — fired /api/workflow-tasks per submission per page,
  // flooding the network with ~25 calls every render. Workflow tasks now load
  // on-demand when the user opens a submission's detail (openSidebarWithTasks).
  // For data fully populated server-side, run Settings → "Sync All Submissions".

  useEffect(() => { setCurrentPage(1); }, [filterDepartment, filterDateFrom, filterDateTo, filterSubmittedBy]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false); };
    if (dropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const currentView = VIEW_OPTIONS.find(v => v.mode === viewMode) || VIEW_OPTIONS[0];
  const CurrentIcon = currentView.icon;

  const calSubmissionsByDay = useMemo(() => {
    const map = new Map<number, Submission[]>();
    filteredAndSortedSubmissions.forEach(s => {
      if (!s.submissionDate) return;
      const d = new Date(s.submissionDate);
      if (d.getFullYear() === calYear && d.getMonth() === calMonth) { const day = d.getDate(); if (!map.has(day)) map.set(day, []); map.get(day)!.push(s); }
    });
    return map;
  }, [filteredAndSortedSubmissions, calYear, calMonth]);

  const { days, monthName } = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth]);

  // ── View Renderers ─────────────────────────────────────────────────────────

  const renderEmpty = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-full flex flex-col items-center justify-center py-16">
      <AlertCircle className="w-12 h-12 text-gray-500 mb-4" />
      <p className="text-gray-600 text-sm">No submissions found</p>
    </motion.div>
  );

  const renderGrid = () => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.05 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      <AnimatePresence>
        {paginatedSubmissions.length > 0 ? paginatedSubmissions.map((sub, idx) => (
          <SubmissionCard key={sub.id} submission={sub} idx={idx} user={user} onViewDetails={handleViewDetails} onOpenModal={openSidebarWithTasks} />
        )) : renderEmpty()}
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
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pending With</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {paginatedSubmissions.map((sub, idx) => {
                const status = getSubmissionStatus(sub);
                return (
                  <motion.tr key={sub.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ delay: idx * 0.02 }}
                    onClick={() => openSidebarWithTasks(sub)} className="border-b border-gray-50 hover:bg-blue-50/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 text-sm text-gray-400 font-mono">{idx + 1}</td>
                    <td className="px-4 py-3"><div><p className="text-sm font-semibold text-gray-900 truncate max-w-[220px]">{sub.formTitle || 'Form Submission'}</p><p className="text-xs font-mono text-blue-600">{sub.id.slice(0, 8).toUpperCase()}</p></div></td>
                    <td className="px-4 py-3"><p className="text-sm font-medium text-gray-800">{sub.submittedBy.name}</p><p className="text-xs text-gray-400 truncate max-w-[160px]">{sub.submittedBy.email}</p></td>
                    <td className="px-4 py-3 text-sm text-gray-700">{sub.submittedBy.department || '—'}</td>
                    <td className="px-4 py-3"><p className="text-sm text-gray-800 font-medium">{displayApproverName(sub.pendingApproverName)}</p>{sub.pendingApproverEmail && <p className="text-xs text-gray-400 truncate max-w-[180px]">{sub.pendingApproverEmail}</p>}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(sub.submissionDate)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full text-white bg-gradient-to-r ${statusConfig[status].color}`}>{statusConfig[status].label}</span></td>
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
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Pending With</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wider w-12">Days</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {paginatedSubmissions.map((sub, idx) => (
                <motion.tr key={sub.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.01 }}
                  onClick={() => openSidebarWithTasks(sub)} className="border-b border-gray-50 hover:bg-blue-50/50 transition-colors cursor-pointer">
                  <td className="px-2 py-1 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-2 py-1"><p className="text-xs font-semibold text-gray-900 truncate max-w-[180px]">{sub.formTitle || '—'}</p><p className="text-[10px] text-gray-400">{sub.submittedBy.department || '—'}</p></td>
                  <td className="px-2 py-1"><p className="text-xs text-gray-800 truncate max-w-[120px]">{sub.submittedBy.name}</p></td>
                  <td className="px-2 py-1"><p className="text-xs text-gray-700 truncate max-w-[120px]">{displayApproverName(sub.pendingApproverName)}</p>{sub.pendingApproverEmail && <p className="text-[10px] text-gray-400 truncate max-w-[120px]">{sub.pendingApproverEmail}</p>}</td>
                  <td className="px-2 py-1 text-xs text-gray-500">{formatDate(sub.submissionDate)}</td>
                  <td className="px-2 py-1 text-xs text-blue-600 font-medium">{sub.daysAtCurrentLevel || 0}d</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTimeline = () => (
    <div className="relative pl-8 border-l-2 border-blue-200 ml-4 space-y-0">
      <AnimatePresence>
        {paginatedSubmissions.map((sub, idx) => {
          const steps = (sub.approvalHistory || []).filter(h => h.status === 'approved').length;
          const status = getSubmissionStatus(sub);
          return (
            <motion.div key={sub.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ delay: idx * 0.03 }}
              onClick={() => openSidebarWithTasks(sub)} className="relative pb-6 cursor-pointer group">
              <div className="absolute -left-[28px] top-1 w-4 h-4 rounded-full bg-blue-400 border-2 border-white shadow group-hover:scale-125 transition-transform" />
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:border-blue-300 transition-all ml-2">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{sub.formTitle || 'Form Submission'}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white bg-gradient-to-r ${statusConfig[status].color}`}>{statusConfig[status].label}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> {sub.submittedBy.name}</span>
                  <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {sub.submittedBy.department || '—'}</span>
                  <span className="flex items-center gap-1 text-blue-600"><Briefcase className="w-3 h-3" /> {displayApproverName(sub.pendingApproverName)}{sub.pendingApproverEmail && <span className="text-gray-400">({sub.pendingApproverEmail})</span>}</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  {Array.from({ length: Math.min(steps, 5) }).map((_, i) => (<div key={i} className="w-5 h-1 rounded-full bg-blue-300" />))}
                  <span className="text-[10px] text-gray-400 ml-1">{steps} step{steps !== 1 ? 's' : ''}</span>
                  <span className="text-[10px] text-blue-500 ml-auto font-medium">{sub.daysAtCurrentLevel || 0}d pending</span>
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
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-blue-100">
        <button onClick={() => calMonth === 0 ? (setCalMonth(11), setCalYear(y => y - 1)) : setCalMonth(m => m - 1)} className="p-1 rounded hover:bg-blue-200 transition-colors"><ChevronLeft className="w-4 h-4 text-blue-700" /></button>
        <h3 className="text-sm font-semibold text-blue-800">{monthName}</h3>
        <button onClick={() => calMonth === 11 ? (setCalMonth(0), setCalYear(y => y + 1)) : setCalMonth(m => m + 1)} className="p-1 rounded hover:bg-blue-200 transition-colors"><ChevronLeft className="w-4 h-4 text-blue-700 rotate-180" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const subs = day ? calSubmissionsByDay.get(day) || [] : [];
          const isToday = day === new Date().getDate() && calMonth === new Date().getMonth() && calYear === new Date().getFullYear();
          return (
            <div key={i} className={`min-h-[80px] border-b border-r border-gray-50 p-1.5 ${!day ? 'bg-gray-50/50' : 'hover:bg-blue-50/30 cursor-pointer transition-colors'} ${isToday ? 'bg-blue-50/50 ring-1 ring-inset ring-blue-300' : ''}`}>
              {day && <p className={`text-xs font-medium mb-0.5 ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>{day}</p>}
              <div className="space-y-0.5">
                {subs.slice(0, 3).map(s => (
                  <div key={s.id} onClick={() => openSidebarWithTasks(s)} className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 truncate hover:bg-blue-200 transition-colors" title={s.formTitle}>{s.formTitle?.slice(0, 18) || s.id.slice(0, 6)}</div>
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
        {paginatedSubmissions.map((sub, idx) => {
          const status = getSubmissionStatus(sub);
          return (
            <motion.div key={sub.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: idx * 0.03 }}
              whileHover={{ y: -4 }} onClick={() => openSidebarWithTasks(sub)}
              className="break-inside-avoid bg-white rounded-xl border border-gray-200 p-5 cursor-pointer shadow-sm hover:shadow-md hover:border-blue-300 transition-all">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{sub.formTitle || 'Form Submission'}</p>
              <p className="text-xs font-mono text-blue-600 mb-2">{sub.id.slice(0, 8).toUpperCase()}</p>
              <div className="flex items-center gap-2 py-2 border-t border-gray-100 text-xs"><User className="w-3.5 h-3.5 text-gray-400" /><span className="font-medium text-gray-700">{sub.submittedBy.name}</span></div>
              <div className="flex items-start gap-2 py-2 border-t border-gray-100 text-xs"><Briefcase className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-gray-700 truncate">{displayApproverName(sub.pendingApproverName)}</p>{sub.pendingApproverEmail && <p className="text-[10px] text-gray-400 truncate">{sub.pendingApproverEmail}</p>}</div></div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100 text-xs">
                <span className="text-gray-400">{formatDate(sub.submissionDate)}</span>
                <span className={`font-bold px-2 py-0.5 rounded-full text-white text-[10px] bg-gradient-to-r ${statusConfig[status].color}`}>{statusConfig[status].label}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  const renderSplit = () => {
    const selected = splitSelected || paginatedSubmissions[0];
    return (
      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{filteredAndSortedSubmissions.length} submissions</div>
          <div className="flex-1 overflow-y-auto">
            {paginatedSubmissions.map(sub => {
              const status = getSubmissionStatus(sub);
              return (
                <div key={sub.id} onClick={() => openSidebarWithTasks(sub)}
                  className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${splitSelected?.id === sub.id ? 'bg-blue-50 border-l-2 border-l-blue-400' : 'hover:bg-gray-50'}`}>
                  <p className="text-xs font-semibold text-gray-900 truncate">{sub.formTitle || '—'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-400">{sub.submittedBy.name}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white bg-gradient-to-r ${statusConfig[status].color}`}>{statusConfig[status].label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {selected && (
          <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 overflow-y-auto">
            <div className="flex items-center gap-2 mb-4">
              <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-lg text-white bg-gradient-to-r ${statusConfig[getSubmissionStatus(selected)].color}`}>{statusConfig[getSubmissionStatus(selected)].label}</span>
              <p className="text-xs text-gray-400 font-mono">{selected.id.slice(0, 8).toUpperCase()}</p>
              {(() => {
                const myRole = getMyWorkflowRole(selected, user?.email);
                return myRole ? <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">You: {myRole}</span> : null;
              })()}
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">{selected.formTitle || 'Form Submission'}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Submitted By</p><p className="font-semibold text-gray-800">{selected.submittedBy.name}</p><p className="text-xs text-gray-500">{selected.submittedBy.email}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Department</p><p className="font-semibold text-gray-800">{selected.submittedBy.department || '—'}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Pending With</p><p className="font-semibold text-gray-800">{displayApproverName(selected.pendingApproverName)}</p>{selected.pendingApproverEmail && <p className="text-xs text-gray-500">{selected.pendingApproverEmail}</p>}</div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Priority</p><p className="font-semibold text-gray-800">{selected.priority?.toUpperCase() || '—'}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Submitted</p><p className="font-semibold text-gray-800">{formatDate(selected.submissionDate)}</p></div>
              <div><p className="text-xs text-gray-400 uppercase mb-0.5">Pending Days</p><p className="font-semibold text-blue-600">{selected.daysAtCurrentLevel || 0} days</p></div>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <motion.button whileHover={{ x: 4 }} onClick={() => openSidebarWithTasks(selected)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-400 to-blue-600 text-white font-semibold text-sm hover:shadow-lg transition-all">
                <span>View Full Details</span><span className="group-hover:translate-x-1 transition-transform">→</span></motion.button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const mainContent = (() => {
    if (filteredAndSortedSubmissions.length === 0) return null;
    if (paginatedSubmissions.length === 0) return renderEmpty();
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

  if (loading) {
    return (
      <div className="space-y-8 w-full px-4">
        <div className="space-y-2">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-20 rounded-lg" />)}
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-24 rounded-lg" />)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonSubmissionCard key={i} />)}
        </div>
      </div>
    );
  }

  // Explicit error state — only when there's nothing to show. If we already have
  // rows (a transient refresh error), keep showing them rather than blanking.
  if (error && allSubmissions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <AlertCircle className="w-10 h-10 text-indigo-400 mb-3" />
        <p className="text-gray-700 font-semibold">Couldn't load submissions</p>
        <p className="text-gray-500 text-sm mt-1 max-w-md">{error}</p>
      </div>
    );
  }

  const pendingCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'pending').length;
  const approvedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'approved').length;
  const completedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'completed').length;
  const rejectedCount = allSubmissions.filter(s => getSubmissionStatus(s) === 'rejected').length;
  const criticalCount = allSubmissions.filter(s => s.daysAtCurrentLevel > 7).length;
  const avgDays = allSubmissions.length > 0
    ? Math.round(allSubmissions.reduce((sum, s) => sum + (s.daysAtCurrentLevel || 0), 0) / allSubmissions.length) : 0;

  const stats = [
    { label: 'Total Submissions', value: allSubmissions.length, color: 'from-blue-500 to-blue-600', trend: allSubmissions.length > 0 ? '+' + allSubmissions.length : '0' },
    { label: 'Pending Review', value: pendingCount, color: 'from-cyan-400 to-sky-500', trend: criticalCount > 0 ? `${criticalCount} critical` : 'On track' },
    { label: 'Approved', value: approvedCount, color: 'from-blue-400 to-blue-600', trend: completedCount + approvedCount > 0 ? '+' + (completedCount + approvedCount) : '0' },
    { label: 'Avg Processing', value: `${avgDays}d`, color: 'from-indigo-400 to-blue-500', trend: avgDays > 0 ? avgDays + 'd' : '—' },
  ];

  return (
    <div className="relative w-full min-h-screen">
      <div className={`space-y-8 w-full px-4 transition-all duration-300 ${workflowSidebarSubmission ? 'md:pr-[620px]' : ''}`}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, idx) => (<StatCard key={idx} idx={idx} label={stat.label} value={stat.value} trend={stat.trend} color={stat.color} />))}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-4">
          <div className="flex-1 relative w-full">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" />
            <input type="text" placeholder="Search by ID, name, or form title..." value={searchQuery} onChange={handleSearchChange}
              className="w-full pl-12 pr-4 py-3 rounded-xl bg-white border border-gray-300 text-black placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200" />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {['all', 'pending', 'approved', 'rejected'].map(status => {
                const filterColors: Record<string, string> = {
                  all: 'from-blue-500 to-blue-600', pending: 'from-cyan-400 to-sky-400', approved: 'from-blue-400 to-blue-600', rejected: 'from-red-500 to-rose-600', completed: 'from-cyan-300 to-blue-400',
                };
                return (
                  <motion.button key={status} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => handleStatusFilter(status)}
                    className={`px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 border ${filterStatus === status ? `bg-gradient-to-r ${filterColors[status]} text-white shadow-lg border-transparent` : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </motion.button>
                );
              })}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <motion.button
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setShowFilters(s => !s)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors shadow-sm ${
                  showFilters || activeFilterCount > 0
                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                <Filter className="w-4 h-4" />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </motion.button>

              {/* View Mode Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button onClick={() => setDropdownOpen(o => !o)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm">
                  <CurrentIcon className="w-4 h-4" /><span>{currentView.label}</span><ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div initial={{ opacity: 0, y: -4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.95 }} transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-1 overflow-hidden">
                      {VIEW_OPTIONS.map(opt => { const Icon = opt.icon; const active = viewMode === opt.mode; return (
                        <button key={opt.mode} onClick={() => { setViewMode(opt.mode); setDropdownOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
                          <Icon className="w-4 h-4" /><span>{opt.label}</span>{active && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                        </button>
                      );})}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="relative">
                <select value={sortBy} onChange={handleSortChange}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold text-sm focus:outline-none focus:border-blue-500 appearance-none pr-8 cursor-pointer">
                  <option value="latest">Latest First</option><option value="oldest">Oldest First</option><option value="days">Days Pending</option>
                </select>
                <ArrowUpDown className="w-4 h-4 absolute right-2 top-2.5 text-gray-600 pointer-events-none" />
              </div>

              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleExport}
                disabled={filteredAndSortedSubmissions.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold text-sm transition-all hover:shadow-lg border border-transparent disabled:opacity-50 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" />Export
              </motion.button>
            </div>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
                    <div className="flex items-center gap-3">
                      {activeFilterCount > 0 && (
                        <button onClick={clearAllFilters} className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                          Clear All
                        </button>
                      )}
                      <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Department</label>
                      <select
                        value={filterDepartment}
                        onChange={e => startTransition(() => setFilterDepartment(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">All Departments</option>
                        {uniqueDepartments.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Submitted By</label>
                      <select
                        value={filterSubmittedBy}
                        onChange={e => startTransition(() => setFilterSubmittedBy(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">All Submitters</option>
                        {uniqueSubmitters.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Date From</label>
                      <input
                        type="date"
                        value={filterDateFrom}
                        onChange={e => startTransition(() => setFilterDateFrom(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Date To</label>
                      <input
                        type="date"
                        value={filterDateTo}
                        onChange={e => startTransition(() => setFilterDateTo(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Main Content Area */}
        {mainContent || (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="w-12 h-12 text-gray-500 mb-4" />
            <p className="text-gray-600 text-sm">No submissions found</p>
          </motion.div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mt-8 px-4 py-4 bg-white rounded-xl border border-gray-200 shadow-sm">
            <p className="text-sm font-semibold text-gray-700">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredAndSortedSubmissions.length)} of {filteredAndSortedSubmissions.length} submissions
            </p>
            <div className="flex gap-2">
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50">Previous</motion.button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => Math.abs(page - currentPage) <= 1 || page === 1 || page === totalPages)
                .map((page, idx, arr) => (
                  <div key={page}>
                    {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-2 text-gray-600">...</span>}
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 rounded-lg font-semibold transition-all ${currentPage === page ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>{page}</motion.button>
                  </div>
                ))}
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50">Next</motion.button>
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {selectedSubmission && <SubmissionModal submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} />}
      </AnimatePresence>

      <WorkflowDetailsSidebar
        isOpen={!!workflowSidebarSubmission} submission={workflowSidebarSubmission} expandedTasks={expandedTasks}
        expandLoading={workflowLoading ? workflowSidebarSubmission?.id : undefined} user={user} showOverlay={false} isAbsolute={true}
        onClose={() => setWorkflowSidebarSubmission(null)} onFetchSignature={fetchAndShowSignature} sigLoading={sigLoading}
        onTaskApprove={openSidebarApproveModal} onSetTaskRejecting={openSidebarApproveModal} onOpenTaskLink={openTaskLink}
      />

      <AnimatePresence>
        {viewSignature && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setViewSignature(null)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()} className="bg-white rounded-2xl overflow-hidden w-full max-w-md shadow-2xl">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Signature</h3>
                <button onClick={() => setViewSignature(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900">✕</button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-gray-500 text-center">L{viewSignature.level} — {viewSignature.approver}</p>
                {viewSignature.allUrls.length === 0 ? (
                  <p className="text-xs text-amber-700 text-center py-4 bg-amber-50 border border-amber-200 rounded">
                    No signature data stored for this submission.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {viewSignature.allUrls.map((url, i) => (
                      <div key={i} className="flex flex-col items-center gap-2">
                        {/* Proxy appends apiKey, follows JotForm's 302 to the
                            signed /_fs/ URL, streams the PNG. Works inline. */}
                        <img
                          src={`/api/signature-proxy?url=${encodeURIComponent(url)}`}
                          alt="Signature"
                          className="max-w-full max-h-[300px] object-contain border border-gray-200 rounded bg-white"
                        />
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Open original in JotForm
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
