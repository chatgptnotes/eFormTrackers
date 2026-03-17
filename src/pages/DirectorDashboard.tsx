import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, MessageSquare, Clock, AlertTriangle, User,
  Search, ArrowUpDown, ChevronDown, ChevronUp, FileText, Loader2,
  TrendingUp, Shield, ExternalLink, ClipboardList, FileEdit, Lock,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useSubmissions } from '../hooks/useSubmissions';
import { Submission } from '../types';
import CommentPanel from '../components/CommentPanel';
import SubmissionModal from '../components/SubmissionModal';
import { getUserConfig } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Props {
  data: ReturnType<typeof useSubmissions>;
}

function AgingCell({ days }: { days: number }) {
  const color = days > 14 ? 'text-red-400' : days > 7 ? 'text-orange-400' : days > 3 ? 'text-amber-400' : 'text-emerald-400';
  const barColor = days > 14 ? 'bg-red-500' : days > 7 ? 'bg-orange-500' : days > 3 ? 'bg-amber-500' : 'bg-emerald-500';
  const barWidth = Math.min(100, (days / 30) * 100);
  return (
    <div className="space-y-1">
      <span className={`text-sm font-bold ${color} ${days > 14 ? 'animate-pulse' : ''}`}>{days}d</span>
      <div className="h-1 w-16 rounded-full bg-navy-light/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  );
}

function PendingWithCell({ submission, onSyncClick }: { submission: Submission; onSyncClick?: (sub: Submission) => void }) {
  const { currentApprovalLevel, approvalHistory, actionType } = submission;

  // Completed or rejected — nothing pending
  if (currentApprovalLevel === 'completed') {
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs text-emerald-400 font-medium">Completed</span>
      </div>
    );
  }
  if (currentApprovalLevel === 'rejected') {
    return (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-400" />
        <span className="text-xs text-red-400 font-medium">Rejected</span>
      </div>
    );
  }

  // Find the pending entry ONLY at the current active level
  const pendingEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel && a.status === 'pending')
    : approvalHistory.find(a => a.status === 'pending');

  // If current level exists in history but is NOT pending (already acted), show acted status
  const currentEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel)
    : null;

  if (!pendingEntry) {
    if (currentEntry && currentEntry.status !== 'pending') {
      return (
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <div>
            <p className="text-xs text-emerald-400 font-medium">
              {currentEntry.status === 'approved' ? 'Approved' : 'Rejected'}
            </p>
            <p className="text-[10px] text-gray-500">by {currentEntry.approverName}</p>
          </div>
        </div>
      );
    }
    return <span className="text-gray-600 text-xs">--</span>;
  }

  const isGenericFallback = /^Level \d+ Approver$/.test(pendingEntry.approverName) || pendingEntry.approverName === 'Approver';
  const isEmail = pendingEntry.approverName.includes('@');
  const displayEmail = pendingEntry.approverEmail || (isEmail ? pendingEntry.approverName : '');
  const displayName = isGenericFallback
    ? ''
    : isEmail ? pendingEntry.approverName.split('@')[0] : pendingEntry.approverName;

  // Workflow step type label
  const aType = submission.actionType as string;
  const stepLabel = aType === 'task' ? 'Task' : aType === 'form' ? 'Form Review' : 'Approval';

  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 shrink-0 ${
        aType === 'task' ? 'bg-gold/20' : aType === 'form' ? 'bg-blue-500/20' : 'bg-purple-500/20'
      }`}>
        {aType === 'task' ? <ClipboardList className="w-3.5 h-3.5 text-gold" /> :
         aType === 'form' ? <FileEdit className="w-3.5 h-3.5 text-blue-400" /> :
         <User className="w-3.5 h-3.5 text-purple-400" />}
      </div>
      <div className="min-w-0">
        {displayName ? (
          <>
            <p className="text-sm text-white leading-tight truncate max-w-[160px]" title={pendingEntry.approverName}>{displayName}</p>
            {displayEmail && !displayName.includes('@') && (
              <p className="text-[10px] text-gray-500 truncate max-w-[160px]" title={displayEmail}>{displayEmail}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-amber-400 italic">{stepLabel} Pending</p>
        )}
        <p className="text-xs text-gray-500">Level {pendingEntry.level} · {stepLabel}</p>
      </div>
    </div>
  );
}

function WorkflowStatusBadge({ submission }: { submission: Submission }) {
  const { currentApprovalLevel, actionType, approvalHistory } = submission;

  if (currentApprovalLevel === 'completed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Completed</span>;
  }
  if (currentApprovalLevel === 'rejected') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Rejected</span>;
  }

  const level = typeof currentApprovalLevel === 'number' ? currentApprovalLevel : 1;
  const hasApproved = approvalHistory.some(h => h.status === 'approved');

  // Show workflow-step-aware status
  if (actionType === 'task') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gold/20 text-gold">L{level} Task Pending</span>;
  }
  if (actionType === 'form') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Form Pending</span>;
  }

  if (hasApproved) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">L{level} Approval Pending</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">L{level} Approval Pending</span>;
}

function StatusBadge({ status }: { status: string }) {
  const lower = (status || '').toLowerCase();
  const styles: Record<string, string> = {
    'pending': 'bg-amber-500/20 text-amber-400',
    'in progress': 'bg-blue-500/20 text-blue-400',
    'completed': 'bg-emerald-500/20 text-emerald-400',
    'approved': 'bg-emerald-500/20 text-emerald-400',
    'rejected': 'bg-red-500/20 text-red-400',
    'denied': 'bg-red-500/20 text-red-400',
  };
  const matched = Object.entries(styles).find(([key]) => lower.includes(key));
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${matched ? matched[1] : 'bg-gray-500/20 text-gray-400'}`}>
      {status || 'Unknown'}
    </span>
  );
}

function LevelBadge({ level }: { level: number | 'completed' | 'rejected' }) {
  if (level === 'completed') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Completed</span>;
  if (level === 'rejected') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Rejected</span>;
  const colors: Record<number, string> = {
    1: 'bg-blue-500/20 text-blue-400',
    2: 'bg-amber-500/20 text-amber-400',
    3: 'bg-purple-500/20 text-purple-400',
    4: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[level] || 'bg-gray-500/20 text-gray-400'}`}>
      L{level}
    </span>
  );
}

export default function DirectorDashboard({ data }: Props) {
  const { activeSidebarCategory, addAuditEntry, activeWorkflowId } = useApp();
  const { user } = useAuth();
  const currentUser = getUserConfig(user?.email);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'daysAtCurrentLevel' | 'submissionDate' | 'currentApprovalLevel'>('submissionDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [syncSubmission, setSyncSubmission] = useState<Submission | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  // When opening the detail modal, clear any inline reject state so the
  // reject input for a different row doesn't stay open in the background.
  const openModal = (sub: Submission) => {
    setRejectingId(null);
    setConfirmRejectId(null);
    setRejectReason('');
    setSelectedSubmission(sub);
  };
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [taskUrlLoading, setTaskUrlLoading] = useState<string | null>(null);
  const [formUrlLoading, setFormUrlLoading] = useState<string | null>(null);
  const dismissedIds = useMemo(() => new Set([...approvedIds, ...rejectedIds]), [approvedIds, rejectedIds]);

  const openTaskUrl = async (sub: Submission) => {
    setTaskUrlLoading(sub.id);
    try {
      const res = await fetch(`/api/task-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.taskUrl || sub.taskUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      if (sub.taskUrl) window.open(sub.taskUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setTaskUrlLoading(null);
    }
  };

  const openFormUrl = async (sub: Submission) => {
    setFormUrlLoading(sub.id);
    try {
      const res = await fetch(`/api/form-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.formUrl || sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      const url = sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setFormUrlLoading(null);
    }
  };

  // Show all submissions — pending, completed, and rejected
  const directorSubmissions = useMemo(() => {
    let subs = data.allSubmissions.filter(s => {
      if (dismissedIds.has(s.id)) return false;
      // Admin sees everything
      if (currentUser.isAdmin) return true;
      // Completed / rejected submissions are visible to everyone
      if (typeof s.currentApprovalLevel !== 'number') return true;
      // Pending submissions: show if at user's approval level
      const atDirectorLevel = currentUser.approvalLevels.includes(s.currentApprovalLevel as number);
      const pendingEntry = s.approvalHistory?.find(a => a.status === 'pending');
      const nameMatch = pendingEntry?.approverName && currentUser.nameMatches.length > 0
        ? currentUser.nameMatches.some(m => pendingEntry.approverName.toLowerCase().includes(m))
        : false;
      return atDirectorLevel || nameMatch;
    });

    // Apply workflow (form) filter from sidebar
    if (activeWorkflowId) {
      subs = subs.filter(s => s.formId === activeWorkflowId);
    }

    // Apply department category filter
    if (activeSidebarCategory?.filter?.departments?.length) {
      subs = subs.filter(s => activeSidebarCategory.filter!.departments!.includes(s.submittedBy.department));
    }
    if (activeSidebarCategory?.filter?.formIds?.length) {
      subs = subs.filter(s => activeSidebarCategory.filter!.formIds!.includes(s.formId));
    }

    // Apply search
    if (search) {
      const q = search.toLowerCase();
      subs = subs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }

    // Sort
    subs.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'daysAtCurrentLevel') cmp = a.daysAtCurrentLevel - b.daysAtCurrentLevel;
      else if (sortKey === 'submissionDate') cmp = a.submissionDate.localeCompare(b.submissionDate);
      else if (sortKey === 'currentApprovalLevel') cmp = Number(a.currentApprovalLevel) - Number(b.currentApprovalLevel);
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return subs;
  }, [data.allSubmissions, activeSidebarCategory, activeWorkflowId, search, sortKey, sortDir, dismissedIds, currentUser]);

  // Stats
  const syncNeededCount = directorSubmissions.filter(s => s.needsSync).length;
  const pendingCount = directorSubmissions.filter(s => typeof s.currentApprovalLevel === 'number').length;
  const completedCount = directorSubmissions.filter(s => s.currentApprovalLevel === 'completed').length;
  const rejectedCount = directorSubmissions.filter(s => s.currentApprovalLevel === 'rejected').length;
  const criticalCount = directorSubmissions.filter(s => s.daysAtCurrentLevel > 7 && typeof s.currentApprovalLevel === 'number').length;
  const avgWait = pendingCount > 0
    ? Math.round(directorSubmissions.filter(s => typeof s.currentApprovalLevel === 'number').reduce((sum, s) => sum + s.daysAtCurrentLevel, 0) / pendingCount)
    : 0;
  const approvedToday = approvedIds.size;

  const pushToJotForm = async (sub: Submission, decision: 'approved' | 'rejected', reason?: string) => {
    if (typeof sub.currentApprovalLevel !== 'number') return;
    // Use the workflow action API to approve/reject directly in JotForm's workflow engine
    const action = decision === 'approved' ? 'approve' : 'reject';
    const res = await fetch('/api/workflow-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: sub.id, action, comment: reason || '' }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Workflow action failed: ${res.status}`);
    }
  };

  const handleReject = async (sub: Submission) => {
    // reason is optional — consistent with modal reject behaviour
    setActionLoading(sub.id);
    try {
      await pushToJotForm(sub, 'rejected', rejectReason.trim());
      addAuditEntry(sub.id, 'rejected', currentUser.name, `Rejected: ${rejectReason.trim()}`);
      // Optimistic update — dashboard reflects immediately
      data.optimisticUpdate(sub.id, { newLevel: 'rejected', newJotformStatus: 'Rejected', approverName: currentUser.name });
      // Patch Supabase cache so next reload also reflects rejection
      supabase.from('jf_submissions').update({ current_level: sub.currentApprovalLevel, status: 'rejected', approver_name: currentUser.name, last_synced: new Date().toISOString() }).eq('jotform_submission_id', sub.id).then(() => {});
      setRejectReason('');
      setRejectingId(null);
      setRejectedIds(prev => new Set([...prev, sub.id]));
      setConfirmRejectId(null);
      // Force refresh after brief delay — gives JotForm time to propagate update
      setTimeout(() => data.refresh({ force: true }), 3000);
    } catch (err) {
      alert(`Rejection failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncConfirm = async (sub: Submission, action: 'approve' | 'reject') => {
    if (typeof sub.currentApprovalLevel !== 'number') return;
    setSyncLoading(true);
    try {
      const lvl = sub.currentApprovalLevel;
      const levelField = sub.levelFieldMap?.find(lf => lf.level === lvl);
      if (!levelField) throw new Error(`No field map for level ${lvl}`);

      const today = new Date();
      const dateStr = `${today.getMonth() + 1}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
      const params = new URLSearchParams();
      params.set(`submission[${levelField.statusFieldId}]`, action === 'approve' ? 'Approved' : 'Rejected');
      if (levelField.approverFieldId) {
        params.set(`submission[${levelField.approverFieldId}]`, 'Synced via JotFlow');
      }
      // Find date field from levelFieldMap raw data if available
      const totalLevels = sub.levelFieldMap?.length || 1;
      const isLastLevel = lvl === totalLevels;
      const overallFieldId = levelField.overallStatusFieldId;
      if (overallFieldId) {
        params.set(`submission[${overallFieldId}]`,
          action === 'reject' ? 'Rejected' : isLastLevel ? 'Completed' : 'In Progress');
      }

      const res = await fetch(`/api/jotform-update?submissionId=${sub.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      // Clear needs_sync in Supabase
      supabase.from('jf_submissions')
        .update({ needs_sync: false, last_synced: new Date().toISOString() })
        .eq('jotform_submission_id', sub.id)
        .then(() => {});

      const newLevel = action === 'reject' ? 'rejected' as const
        : isLastLevel ? 'completed' as const
        : (lvl + 1) as 1 | 2 | 3 | 4;
      const newStatus = action === 'reject' ? 'Rejected' : isLastLevel ? 'Completed' : 'In Progress';
      data.optimisticUpdate(sub.id, { newLevel, newJotformStatus: newStatus, approverName: 'Synced via JotFlow', approvalDate: dateStr });
      addAuditEntry(sub.id, action === 'approve' ? 'approved' : 'rejected', 'JotFlow Sync', `Native JotForm action synced as ${action}`);

      setSyncSubmission(null);
      setTimeout(() => data.refresh({ force: true }), 3000);
    } catch (err) {
      alert(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: typeof sortKey }) => (
    sortKey === field
      ? (sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />)
      : <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
  );

  // Skeleton: only shown on very first load when Supabase cache is also empty
  if (data.loading && data.allSubmissions.length === 0) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="glass-card p-5 border border-gold/20">
          <div className="h-7 bg-navy-light/30 rounded w-64 mb-2" />
          <div className="h-4 bg-navy-light/20 rounded w-48" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-4">
              <div className="h-8 bg-navy-light/30 rounded w-12 mb-1" />
              <div className="h-3 bg-navy-light/20 rounded w-24" />
            </div>
          ))}
        </div>
        <div className="glass-card overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="border-b border-navy-light/10 px-4 py-4 flex items-center gap-4">
              <div className="h-4 bg-navy-light/30 rounded w-14" />
              <div className="h-4 bg-navy-light/20 rounded w-52" />
              <div className="h-4 bg-navy-light/20 rounded w-32 ml-4" />
              <div className="h-4 bg-navy-light/20 rounded w-10 ml-auto" />
              <div className="h-6 bg-navy-light/30 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 border border-gold/20 bg-gradient-to-r from-gold/5 to-transparent"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">
              Welcome, {currentUser.name} — <span className="text-gold capitalize">{currentUser.role}</span>
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {directorSubmissions.length > 0
                ? `${directorSubmissions.length} submission${directorSubmissions.length !== 1 ? 's' : ''} — ${pendingCount} pending, ${completedCount} completed, ${rejectedCount} rejected`
                : 'No submissions found'}
            </p>
            {activeWorkflowId && (
              <p className="text-xs text-gold/70 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gold/70 inline-block" />
                Workflow: {data.allSubmissions.find(s => s.formId === activeWorkflowId)?.formTitle ?? activeWorkflowId}
              </p>
            )}
            {!activeWorkflowId && activeSidebarCategory?.label && activeSidebarCategory.id !== 'all' && (
              <p className="text-xs text-gray-500 mt-0.5">Filter: {activeSidebarCategory.label}</p>
            )}
          </div>
          <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center">
            <User className="w-6 h-6 text-gold" />
          </div>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: syncNeededCount > 0 ? `Pending (${syncNeededCount} sync)` : 'Pending Approval', value: pendingCount, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Completed', value: completedCount + approvedToday, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: rejectedCount, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Critical (>7d)', value: criticalCount, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Search */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by reference, title, submitter, or form type..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-light/20">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ref#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title / Form</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('currentApprovalLevel')}>
                  <div className="flex items-center gap-1">Level <SortIcon field="currentApprovalLevel" /></div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pending With</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('daysAtCurrentLevel')}>
                  <div className="flex items-center gap-1">Aging <SortIcon field="daysAtCurrentLevel" /></div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {directorSubmissions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Shield className="w-10 h-10 text-emerald-400/50" />
                        <p className="text-gray-400">No submissions found</p>
                        <p className="text-xs text-gray-600">Try clearing your search or filters</p>
                      </div>
                    </td>
                  </tr>
                )}
                {directorSubmissions.map((sub) => (
                  <motion.tr
                    key={sub.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 50, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="border-b border-navy-light/10 hover:bg-navy-light/5"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openModal(sub)}
                        className="text-sm font-mono text-gold hover:underline block"
                      >
                        {sub.referenceNumber.split('-').pop()}
                      </button>
                      <a
                        href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-gray-600 hover:text-gold flex items-center gap-0.5 mt-0.5"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> View in JotForm
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-white hover:text-gold hover:underline inline-flex items-center gap-1 group"
                      >
                        {sub.title}
                        <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-gold transition-colors" />
                      </a>
                      <p className="text-xs text-gray-500">{sub.formTitle}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-300">{sub.submittedBy.name}</p>
                      <p className="text-xs text-gray-500">{sub.submittedBy.department}</p>
                    </td>
                    <td className="px-4 py-3">
                      <LevelBadge level={sub.currentApprovalLevel} />
                    </td>
                    <td className="px-4 py-3">
                      <PendingWithCell submission={sub} onSyncClick={setSyncSubmission} />
                    </td>
                    <td className="px-4 py-3">
                      <AgingCell days={sub.daysAtCurrentLevel} />
                    </td>
                    <td className="px-4 py-3">
                      <WorkflowStatusBadge submission={sub} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {sub.currentApprovalLevel === 'completed' ? (
                          /* ── COMPLETED ── */
                          <div className="flex flex-col items-start gap-1">
                            <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium flex items-center gap-1 border border-emerald-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Approved & Completed
                            </span>
                            <a href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gold flex items-center gap-1 transition-colors">
                              <ExternalLink className="w-3 h-3" /> View in JotForm
                            </a>
                          </div>
                        ) : sub.currentApprovalLevel === 'rejected' ? (
                          /* ── REJECTED ── */
                          <div className="flex flex-col items-start gap-1">
                            <span className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium flex items-center gap-1 border border-red-500/20">
                              <XCircle className="w-3.5 h-3.5" /> Rejected
                            </span>
                            <a href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gold flex items-center gap-1 transition-colors">
                              <ExternalLink className="w-3 h-3" /> View in JotForm
                            </a>
                          </div>
                        ) : sub.actionType === 'task' ? (
                          /* ── TASK step: only show View Task button ── */
                          <button
                            onClick={() => openTaskUrl(sub)}
                            disabled={taskUrlLoading === sub.id}
                            className="px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                          >
                            {taskUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                            View Task
                          </button>
                        ) : sub.actionType === 'form' ? (
                          /* ── FORM step: only show View Form button ── */
                          <button
                            onClick={() => openFormUrl(sub)}
                            disabled={formUrlLoading === sub.id}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                          >
                            {formUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileEdit className="w-3.5 h-3.5" />}
                            Complete Form
                          </button>
                        ) : (
                          /* ── APPROVAL step: Review + Reject + Comment + secondary links ── */
                          <>
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {typeof sub.currentApprovalLevel === 'number' && (currentUser.isAdmin || currentUser.approvalLevels.includes(sub.currentApprovalLevel)) ? (
                                <button
                                  onClick={() => openModal(sub)}
                                  disabled={actionLoading === sub.id}
                                  className="px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                                  title={"Review & Approve"}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {"Review & Approve"}
                                </button>
                              ) : typeof sub.currentApprovalLevel === 'number' ? (
                                <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title={`Your role cannot approve Level ${sub.currentApprovalLevel}`}>
                                  <Lock className="w-3.5 h-3.5" /> Not your level
                                </span>
                              ) : null}

                              {confirmRejectId === sub.id ? (
                                <div className="flex items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1">
                                  <span className="text-[11px] text-red-400">Confirm reject?</span>
                                  <button
                                    onClick={() => handleReject(sub)}
                                    disabled={actionLoading === sub.id}
                                    className="px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-500 disabled:opacity-50 flex items-center gap-1"
                                  >
                                    {actionLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                    Yes
                                  </button>
                                  <button onClick={() => { setConfirmRejectId(null); setRejectingId(sub.id); }} className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-300">
                                    No
                                  </button>
                                </div>
                              ) : rejectingId === sub.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={rejectReason}
                                    onChange={e => setRejectReason(e.target.value)}
                                    placeholder="Reason..."
                                    autoFocus
                                    className="w-28 px-2 py-1 text-xs rounded bg-navy-dark border border-red-500/30 text-white placeholder-gray-600 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => setConfirmRejectId(sub.id)}
                                    disabled={false}
                                    className="px-2 py-1 rounded bg-red-500/30 text-red-400 text-xs hover:bg-red-500/40 disabled:opacity-50"
                                  >
                                    OK
                                  </button>
                                  <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-300">
                                    X
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setRejectingId(sub.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium flex items-center gap-1 border border-red-500/20 transition-colors"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </button>
                              )}

                              <button
                                onClick={() => setCommentingId(commentingId === sub.id ? null : sub.id)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border transition-colors ${
                                  commentingId === sub.id
                                    ? 'bg-blue-500/30 text-blue-300 border-blue-500/30'
                                    : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/20'
                                }`}
                              >
                                <MessageSquare className="w-3.5 h-3.5" /> Comment
                              </button>
                            </div>

                            {/* Secondary: View Task / View Form reference links */}
                            <div className="flex items-center justify-center gap-3">
                              {sub.taskUrl && (
                                <button
                                  onClick={() => openTaskUrl(sub)}
                                  disabled={taskUrlLoading === sub.id}
                                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-gold transition-colors disabled:opacity-50"
                                >
                                  {taskUrlLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />}
                                  {taskUrlLoading === sub.id ? 'Loading...' : 'View Task'}
                                </button>
                              )}
                              {sub.formUrl && (
                                <button
                                  onClick={() => openFormUrl(sub)}
                                  disabled={formUrlLoading === sub.id}
                                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                                >
                                  {formUrlLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileEdit className="w-3 h-3" />}
                                  {formUrlLoading === sub.id ? 'Loading...' : 'Complete Form'}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Inline Comment Panel */}
                      <AnimatePresence>
                        {commentingId === sub.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2"
                          >
                            <CommentPanel
                              submissionId={sub.id}
                              onClose={() => setCommentingId(null)}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-navy-light/20 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing {directorSubmissions.length} pending approval{directorSubmissions.length !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <TrendingUp className="w-3.5 h-3.5" />
            Sort: {sortKey === 'daysAtCurrentLevel' ? 'Aging' : sortKey === 'submissionDate' ? 'Date' : 'Level'} ({sortDir})
          </div>
        </div>
      </motion.div>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <SubmissionModal
          submission={selectedSubmission}
          onClose={() => setSelectedSubmission(null)}
          onUpdate={(updatedId, newLevel, newStatus) => {
            setSelectedSubmission(null);
            if (updatedId) {
              data.optimisticUpdate(updatedId, { newLevel, newJotformStatus: newStatus, approverName: currentUser.name });
            }
            // Delay force refresh by 3s to let JotForm propagate the update
            setTimeout(() => data.refresh({ force: true }), 3000);
          }}
        />
      )}

      {/* Sync Confirmation Modal */}
      <AnimatePresence>
        {syncSubmission && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !syncLoading && setSyncSubmission(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass-card p-6 max-w-sm w-full mx-4 border border-amber-500/30"
            >
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-white">Sync Native Action</h3>
              </div>
              <p className="text-sm text-gray-300 mb-1">
                <span className="text-gold font-mono">{syncSubmission.referenceNumber}</span> — {syncSubmission.submittedBy.name}
              </p>
              <p className="text-sm text-gray-400 mb-4">
                This submission was acted upon in JotForm's native inbox but the dashboard fields weren't updated. What was the action?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleSyncConfirm(syncSubmission, 'approve')}
                  disabled={syncLoading}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {syncLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Approved
                </button>
                <button
                  onClick={() => handleSyncConfirm(syncSubmission, 'reject')}
                  disabled={syncLoading}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {syncLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Rejected
                </button>
              </div>
              <button
                onClick={() => setSyncSubmission(null)}
                disabled={syncLoading}
                className="w-full mt-3 px-4 py-2 rounded-lg text-gray-500 hover:text-gray-300 text-xs transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
