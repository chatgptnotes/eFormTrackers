import React, { useState, useMemo, useEffect, useTransition, useDeferredValue, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, MessageSquare, Clock, AlertTriangle, User,
  Search, ArrowUpDown, ChevronDown, ChevronUp, FileText, Loader2,
  TrendingUp, Shield, ExternalLink, ClipboardList, FileEdit, Lock,
  ChevronLeft, ChevronRight, UserCheck, Eye, Trash2, Filter, Download, X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useSubmissions } from '../hooks/useSubmissions';
import { Submission, WorkflowTask } from '../types';
import CommentPanel from '../components/CommentPanel';
import SubmissionModal from '../components/SubmissionModal';
import WorkflowDetailsModal from '../components/WorkflowDetailsModal';
import WorkflowDetailsSidebar from '../components/WorkflowDetailsSidebar';
import { DashboardStats } from '../components/dashboard/DashboardStats';
import { FilterPanel } from '../components/dashboard/FilterPanel';
import { PaginationFooter } from '../components/dashboard/PaginationFooter';
import { SyncConfirmModal } from '../components/dashboard/SyncConfirmModal';
import { SignatureViewerModal } from '../components/dashboard/SignatureViewerModal';
import { getUserConfig, isSubmissionVisible } from '../config/currentUser';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { jotformHeaders } from '../lib/jotformKey';
import { exportToExcel } from '../services/exportService';

interface Props {
  data: ReturnType<typeof useSubmissions>;
}

const AgingCell = memo(function AgingCell({ days }: { days: number }) {
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
});

const PendingWithCell = memo(function PendingWithCell({ submission, onSyncClick }: { submission: Submission; onSyncClick?: (sub: Submission) => void }) {
  const { currentApprovalLevel, approvalHistory, actionType } = submission;

  // Completed or rejected — nothing pending
  if (currentApprovalLevel === 'completed') {
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
        <span className="text-xs text-white font-medium">Completed</span>
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
});

const WorkflowStatusBadge = memo(function WorkflowStatusBadge({ submission }: { submission: Submission }) {
  const { currentApprovalLevel, actionType, approvalHistory } = submission;

  if (currentApprovalLevel === 'completed') {
    return <span className="text-xs font-medium text-emerald-400">Completed</span>;
  }
  if (currentApprovalLevel === 'rejected') {
    return <span className="text-xs font-medium text-red-400">Rejected</span>;
  }

  const level = typeof currentApprovalLevel === 'number' ? currentApprovalLevel : 1;
  const hasApproved = approvalHistory.some(h => h.status === 'approved');

  // Show workflow-step-aware status
  if (actionType === 'task') {
    return <span className="text-xs font-medium text-amber-400">L{level} Task Pending</span>;
  }
  if (actionType === 'form') {
    return <span className="text-xs font-medium text-blue-400">Form Pending</span>;
  }

  if (hasApproved) {
    return <span className="text-xs font-medium text-indigo-400">L{level} Approval Pending</span>;
  }
  return <span className="text-xs font-medium text-amber-400">L{level} Approval Pending</span>;
});

const StatusBadge = memo(function StatusBadge({ status }: { status: string }) {
  const lower = (status || '').toLowerCase();
  const styles: Record<string, string> = {
    'pending': 'text-amber-400',
    'in progress': 'text-blue-400',
    'completed': 'text-emerald-400',
    'approved': 'text-emerald-400',
    'rejected': 'text-red-400',
    'denied': 'text-red-400',
  };
  const matched = Object.entries(styles).find(([key]) => lower.includes(key));
  const colorClass = matched ? matched[1] : 'text-gray-400';
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {status || 'Unknown'}
    </span>
  );
});

const LevelBadge = memo(function LevelBadge({ level }: { level: number | 'completed' | 'rejected' }) {
  if (level === 'completed') return <span className="text-xs font-medium text-emerald-400">Completed</span>;
  if (level === 'rejected') return <span className="text-xs font-medium text-red-400">Rejected</span>;
  const colors: Record<number, string> = {
    1: 'text-blue-400',
    2: 'text-amber-400',
    3: 'text-purple-400',
    4: 'text-red-400',
    5: 'text-teal-400',
    6: 'text-pink-400',
    7: 'text-indigo-400',
    8: 'text-orange-400',
    9: 'text-cyan-400',
    10: 'text-lime-400',
  };
  const colorClass = colors[level] || 'text-gray-400';
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      L{level}
    </span>
  );
});

function isAssignedToSpecificPerson(submission: Submission): boolean {
  const { currentApprovalLevel, approvalHistory } = submission;
  const pendingEntry = typeof currentApprovalLevel === 'number'
    ? approvalHistory.find(a => a.level === currentApprovalLevel && a.status === 'pending')
    : approvalHistory.find(a => a.status === 'pending');
  if (!pendingEntry) return false;
  const isGenericFallback = /^Level \d+ Approver$/.test(pendingEntry.approverName) || pendingEntry.approverName === 'Approver';
  return !isGenericFallback;
}

export default function DirectorDashboard({ data }: Props) {
  const { activeSidebarCategory, addAuditEntry, activeWorkflowId } = useApp();
  const { user, orgRole } = useAuth();
  const currentUser = getUserConfig(user?.email);
  const isViewer = orgRole === 'viewer';

  // Fiber optimizations
  const [isPending, startTransition] = useTransition();

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
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<WorkflowTask[]>([]);
  const [workflowCache, setWorkflowCache] = useState<Map<string, WorkflowTask[]>>(new Map());
  const [expandLoading, setExpandLoading] = useState<string | null>(null);
  const [workflowModalSubmission, setWorkflowModalSubmission] = useState<Submission | null>(null);
  const [workflowSidebarSubmission, setWorkflowSidebarSubmission] = useState<Submission | null>(null);
  const [taskActionLoading, setTaskActionLoading] = useState<string | null>(null);
  const [taskRejectingId, setTaskRejectingId] = useState<string | null>(null);
  const [taskRejectReason, setTaskRejectReason] = useState('');
  const [taskConfirmRejectId, setTaskConfirmRejectId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewSignature, setViewSignature] = useState<{ url: string; approver: string; level: number } | null>(null);
  const [sigLoading, setSigLoading] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterLevel, setFilterLevel] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSubmittedBy, setFilterSubmittedBy] = useState('');

  // Defer expensive search/filter rendering
  const deferredSearch = useDeferredValue(search);

  const toggleRowExpand = async (sub: Submission) => {
    if (expandedRowId === sub.id) {
      setExpandedRowId(null);
      setExpandedTasks([]);
      return;
    }
    setExpandLoading(sub.id);
    try {
      const res = await fetch(`/api/workflow-tasks?submissionId=${sub.id}`);
      if (!res.ok) { setExpandLoading(null); return; }
      const json = await res.json();
      setExpandedRowId(sub.id);
      setExpandedTasks(json.tasks || []);
    } catch {
      setExpandedRowId(sub.id);
      setExpandedTasks([]);
    } finally {
      setExpandLoading(null);
    }
  };

  const refreshExpandedTasks = async (submissionId: string) => {
    try {
      const res = await fetch(`/api/workflow-tasks?submissionId=${submissionId}`);
      if (res.ok) {
        const json = await res.json();
        setExpandedTasks(json.tasks || []);
        setWorkflowCache(prev => {
          const next = new Map(prev);
          next.set(submissionId, json.tasks || []);
          return next;
        });
      }
    } catch { /* ignore */ }
  };

  // Drop a submission's cached workflow tasks so the next sidebar/row open
  // forces a fresh fetch — call after approve/reject/complete actions.
  const invalidateWorkflowCache = (submissionId: string) => {
    setWorkflowCache(prev => {
      if (!prev.has(submissionId)) return prev;
      const next = new Map(prev);
      next.delete(submissionId);
      return next;
    });
    try { localStorage.removeItem('jotflow_submissions_cache'); } catch { /* ignore */ }
  };

  const openSidebarWithTasks = async (sub: Submission) => {
    setWorkflowSidebarSubmission(sub);

    // Check if already cached
    if (workflowCache.has(sub.id)) {
      setExpandedTasks(workflowCache.get(sub.id) || []);
      return;
    }

    setExpandLoading(sub.id);
    try {
      // Pass workflowInstanceId to skip slow submission fetch in API
      const url = `/api/workflow-tasks?submissionId=${sub.id}${sub.workflowInstanceId ? `&workflowInstanceId=${sub.workflowInstanceId}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { setExpandLoading(null); return; }
      const json = await res.json();
      const tasks = json.tasks || [];
      setExpandedTasks(tasks);
      setWorkflowCache(prev => new Map(prev).set(sub.id, tasks));
    } catch {
      setExpandedTasks([]);
    } finally {
      setExpandLoading(null);
    }
  };

  // Pre-fetch workflows - Build cache. Skips submissions already cached
  // so re-running on filter/sort/page change is a no-op when nothing new
  // entered the visible window.
  const preFetchWorkflows = useCallback(async (submissions: Submission[]) => {
    if (submissions.length === 0) return;
    const toFetch = submissions.filter(s => !workflowCache.has(s.id));
    if (toFetch.length === 0) return;

    await Promise.all(toFetch.map(async (sub) => {
      try {
        const url = `/api/workflow-tasks?submissionId=${sub.id}${sub.workflowInstanceId ? `&workflowInstanceId=${sub.workflowInstanceId}` : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const tasks = json.tasks || [];
          setWorkflowCache(prevCache => {
            if (prevCache.has(sub.id)) return prevCache;
            const newCache = new Map(prevCache);
            newCache.set(sub.id, tasks);
            return newCache;
          });
        }
      } catch (err) {
        console.warn(`Failed to pre-fetch ${sub.id}:`, err);
      }
    }));
  }, [workflowCache]);

  const openWorkflowModal = async (sub: Submission) => {
    setWorkflowModalSubmission(sub);
    setExpandLoading(sub.id);
    try {
      const res = await fetch(`/api/workflow-tasks?submissionId=${sub.id}`);
      if (!res.ok) { setExpandLoading(null); return; }
      const json = await res.json();
      setExpandedTasks(json.tasks || []);
    } catch {
      setExpandedTasks([]);
    } finally {
      setExpandLoading(null);
    }
  };

  const handleDeleteAll = async () => {
    setDeletingId('all');
    const ids = directorSubmissions.map(s => s.id);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/delete-submission?submissionId=${id}`, { method: 'DELETE' });
        if (res.ok) deleted++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setDeleteConfirmId(null);
    setDeletingId(null);
    alert(`Deleted ${deleted} submission(s)${failed ? `, ${failed} failed` : ''}`);
    data.scheduleRefreshAfterAction();
  };

  const handleTaskApprove = async (submissionId: string) => {
    setTaskActionLoading(submissionId);
    try {
      const res = await fetch('/api/workflow-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, action: 'approve' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Approve failed: ${res.status}`);
      }
      invalidateWorkflowCache(submissionId);
      await refreshExpandedTasks(submissionId);
      data.scheduleRefreshAfterAction();
    } catch (err) {
      alert(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTaskActionLoading(null);
    }
  };

  const handleTaskReject = async (submissionId: string, reason: string) => {
    setTaskActionLoading(submissionId);
    try {
      const res = await fetch('/api/workflow-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, action: 'reject', comment: reason }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Reject failed: ${res.status}`);
      }
      setTaskRejectingId(null);
      setTaskRejectReason('');
      setTaskConfirmRejectId(null);
      invalidateWorkflowCache(submissionId);
      await refreshExpandedTasks(submissionId);
      data.scheduleRefreshAfterAction();
    } catch (err) {
      alert(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTaskActionLoading(null);
    }
  };

  const handleTaskComplete = async (submissionId: string) => {
    setTaskActionLoading(submissionId);
    try {
      const res = await fetch('/api/workflow-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, action: 'complete' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Complete failed: ${res.status}`);
      }
      invalidateWorkflowCache(submissionId);
      await refreshExpandedTasks(submissionId);
      data.scheduleRefreshAfterAction();
    } catch (err) {
      alert(`Complete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTaskActionLoading(null);
    }
  };

  const fetchAndShowSignature = async (submissionId: string, level: number, taskId: string) => {
    setSigLoading(taskId);
    try {
      const data = await apiFetch<{ signature_url?: string; approver_name?: string } | null>(
        `/api/signatures?submission_id=${submissionId}&level=${level}`
      );

      if (data?.signature_url) {
        setViewSignature({ url: data.signature_url, approver: data.approver_name || 'Unknown', level });
      } else {
        alert('Signature not found');
      }
    } catch (err) {
      alert('Failed to fetch signature');
    } finally {
      setSigLoading(null);
    }
  };

  const openTaskLink = async (task: WorkflowTask) => {
    // Find the submission this task belongs to so we can call /api/email-url,
    // which builds the proper /approval-form/{formID}/task/{taskID}/access-token/{token}
    // URL. Constructing the URL inline without the access token returns 404.
    const sub =
      workflowSidebarSubmission ||
      workflowModalSubmission ||
      data.allSubmissions.find(s => s.id === expandedRowId) ||
      null;

    if (sub) {
      try {
        const res = await fetch(`/api/email-url?formId=${sub.formId}&submissionId=${sub.id}`);
        const json = await res.json();
        if (json?.approvalUrl) {
          window.open(json.approvalUrl, '_blank', 'noopener,noreferrer');
          return;
        }
      } catch { /* fall through to legacy fallback */ }
    }

    // Last-resort fallback for cases where we have no submission context.
    // These URLs will 404 without an access token but at least preserve
    // the previous behavior rather than failing silently.
    if (task.accessLink) {
      window.open(task.accessLink, '_blank', 'noopener,noreferrer');
    } else if (task.internalFormID && task.taskId) {
      const host = 'https://eforms.mediaoffice.ae';
      const qp = task.type === 'workflow_assign_form' ? 'workflowAssignFormTask'
        : task.type === 'workflow_assign_task' ? 'workflowAssignTask'
        : 'workflowApprovalTask';
      window.open(`${host}/${task.internalFormID}?${qp}=1&taskID=${task.taskId}`, '_blank', 'noopener,noreferrer');
    }
  };

  const dismissedIds = useMemo(() => new Set([...approvedIds, ...rejectedIds]), [approvedIds, rejectedIds]);

  const openTaskUrl = async (sub: Submission) => {
    setTaskUrlLoading(sub.id);
    try {
      // Use email-url endpoint which builds the correct workflow-aware URL with taskID
      const res = await fetch(`/api/email-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.approvalUrl || sub.approvalUrl || sub.taskUrl;
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
      // Use email-url endpoint which builds the correct workflow-aware URL with taskID
      const res = await fetch(`/api/email-url?formId=${sub.formId}&submissionId=${sub.id}`);
      const data = await res.json();
      const url = data.approvalUrl || sub.approvalUrl || sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      const url = sub.formUrl || sub.editLink;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setFormUrlLoading(null);
    }
  };

  // Show only active submissions — pending and rejected. Completed belong on /app/completed
  const directorSubmissions = useMemo(() => {
    let subs = data.allSubmissions.filter(s => {
      if (dismissedIds.has(s.id)) return false;
      if (s.currentApprovalLevel === 'completed') return false;
      return isSubmissionVisible(s, user?.email, currentUser, orgRole);
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

    // Apply search (deferred for better performance)
    if (deferredSearch) {
      const q = deferredSearch.toLowerCase();
      subs = subs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }

    // Assigned to Me filter
    if (assignedToMe && user?.email) {
      const myEmail = user.email.toLowerCase();
      subs = subs.filter(s => {
        if (s.pendingApproverEmail?.toLowerCase() === myEmail) return true;
        const pendingEntry = s.approvalHistory?.find(a => a.status === 'pending');
        if (pendingEntry?.approverEmail?.toLowerCase() === myEmail) return true;
        if (pendingEntry?.approverName && currentUser.nameMatches.length > 0) {
          return currentUser.nameMatches.some(m => pendingEntry.approverName.toLowerCase().includes(m));
        }
        return false;
      });
    }

    // Level filter
    if (filterLevel) {
      if (filterLevel === 'completed') {
        subs = subs.filter(s => s.currentApprovalLevel === 'completed');
      } else if (filterLevel === 'rejected') {
        subs = subs.filter(s => s.currentApprovalLevel === 'rejected');
      } else {
        subs = subs.filter(s => String(s.currentApprovalLevel) === filterLevel);
      }
    }

    // Department filter
    if (filterDepartment) {
      subs = subs.filter(s => s.submittedBy.department === filterDepartment);
    }

    // Status filter
    if (filterStatus) {
      const st = filterStatus.toLowerCase();
      if (st === 'pending') subs = subs.filter(s => typeof s.currentApprovalLevel === 'number');
      else if (st === 'completed') subs = subs.filter(s => s.currentApprovalLevel === 'completed');
      else if (st === 'rejected') subs = subs.filter(s => s.currentApprovalLevel === 'rejected');
    }

    // Date range filter
    if (filterDateFrom) {
      const from = new Date(filterDateFrom);
      subs = subs.filter(s => new Date(s.submissionDate) >= from);
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo);
      to.setHours(23, 59, 59, 999);
      subs = subs.filter(s => new Date(s.submissionDate) <= to);
    }

    // Submitted By filter
    if (filterSubmittedBy) {
      subs = subs.filter(s => s.submittedBy.name === filterSubmittedBy);
    }

    // Sort
    subs.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'daysAtCurrentLevel') cmp = a.daysAtCurrentLevel - b.daysAtCurrentLevel;
      else if (sortKey === 'submissionDate') {
        cmp = new Date(a.submissionDate).getTime() - new Date(b.submissionDate).getTime();
        if (cmp === 0) cmp = Number(a.id) - Number(b.id); // tiebreak: higher ID = newer submission
      }
      else if (sortKey === 'currentApprovalLevel') cmp = Number(a.currentApprovalLevel) - Number(b.currentApprovalLevel);
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return subs;
  }, [data.allSubmissions, activeSidebarCategory, activeWorkflowId, deferredSearch, sortKey, sortDir, dismissedIds, currentUser, assignedToMe, user?.email, filterLevel, filterDepartment, filterStatus, filterDateFrom, filterDateTo, filterSubmittedBy, isViewer]);

  // Group parent + child submissions by workflowInstanceId
  const { parentSubmissions } = useMemo(() => {
    // Filter to show only PRIMARY forms - exclude secondary forms like "Workflow Form", "Task", etc.
    const primaryFormSubmissions = directorSubmissions.filter(sub => {
      // Show submissions that don't have 'Workflow Form' in the title (hide secondary forms)
      return !sub.formTitle.includes('Workflow Form');
    });

    // Group by workflowInstanceId - submissions from same workflow instance are grouped
    const byWorkflowId = new Map<string, Submission[]>();
    const ungrouped: Submission[] = [];

    console.log(`[DirectorDashboard] Grouping ${primaryFormSubmissions.length} primary submissions:`);
    for (const sub of primaryFormSubmissions) {
      console.log(`  Sub ${sub.id}: form="${sub.formTitle}", actionType="${sub.actionType}", wfInstanceId="${sub.workflowInstanceId}"`);
      if (sub.workflowInstanceId) {
        if (!byWorkflowId.has(sub.workflowInstanceId)) {
          byWorkflowId.set(sub.workflowInstanceId, []);
        }
        byWorkflowId.get(sub.workflowInstanceId)!.push(sub);
      } else {
        // No workflowInstanceId - treat as separate submission
        ungrouped.push(sub);
      }
    }
    console.log(`[DirectorDashboard] After grouping: ${byWorkflowId.size} workflows with ${Array.from(byWorkflowId.values()).reduce((sum, arr) => sum + arr.length, 0)} submissions, ${ungrouped.length} ungrouped`);

    // Keep only the FIRST (earliest by ID) submission per workflow
    const result: Submission[] = [];
    for (const subs of byWorkflowId.values()) {
      subs.sort((a, b) => Number(a.id) - Number(b.id));
      result.push(subs[0]);
    }
    result.push(...ungrouped);

    // Sort by submission date - newest first
    result.sort((a, b) => {
      const dateA = new Date(a.submissionDate).getTime();
      const dateB = new Date(b.submissionDate).getTime();
      return dateB - dateA;
    });

    return { parentSubmissions: result, childrenByParentId: new Map() };
  }, [directorSubmissions]);

  // Unique filter options derived from all submissions
  const uniqueDepartments = useMemo(() => {
    const deps = new Set(data.allSubmissions.map(s => s.submittedBy.department).filter(Boolean));
    return Array.from(deps).sort();
  }, [data.allSubmissions]);

  const uniqueLevels = useMemo(() => {
    const lvls = new Set<string>();
    data.allSubmissions.forEach(s => {
      if (s.currentApprovalLevel !== 'completed') {
        lvls.add(String(s.currentApprovalLevel));
      }
    });
    return Array.from(lvls).sort();
  }, [data.allSubmissions]);

  const uniqueSubmitters = useMemo(() => {
    const names = new Set(data.allSubmissions.map(s => s.submittedBy.name).filter(Boolean));
    return Array.from(names).sort();
  }, [data.allSubmissions]);

  const activeFilterCount = [filterLevel, filterDepartment, filterStatus, filterDateFrom, filterDateTo, filterSubmittedBy].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterLevel('');
    setFilterDepartment('');
    setFilterStatus('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterSubmittedBy('');
  };

  // Reset to page 1 when filters/search/sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [parentSubmissions.length, search, sortKey, sortDir, filterLevel, filterDepartment, filterStatus, filterDateFrom, filterDateTo, filterSubmittedBy]);

  // Pagination
  const totalPages = Math.ceil(parentSubmissions.length / rowsPerPage);
  const safeCurrentPage = Math.min(currentPage, totalPages || 1);
  const paginatedSubmissions = parentSubmissions.slice(
    (safeCurrentPage - 1) * rowsPerPage,
    safeCurrentPage * rowsPerPage
  );

  // Pre-fetch workflows for the visible page. Re-runs when filters/sort
  // change the visible window, not only on page navigation.
  useEffect(() => {
    if (paginatedSubmissions.length > 0) {
      preFetchWorkflows(paginatedSubmissions);
    }
  }, [paginatedSubmissions, preFetchWorkflows]);

  // Stats — single pass over parentSubmissions, memoized so stat counters only recompute when data changes.
  const { syncNeededCount, pendingCount, rejectedCount, criticalCount, avgWait } = useMemo(() => {
    let sync = 0, pending = 0, rejected = 0, critical = 0, waitSum = 0;
    for (const s of parentSubmissions) {
      if (s.needsSync) sync++;
      const isPending = typeof s.currentApprovalLevel === 'number';
      if (isPending) { pending++; waitSum += s.daysAtCurrentLevel; }
      if (s.currentApprovalLevel === 'rejected') rejected++;
      if (isPending && s.daysAtCurrentLevel > 7) critical++;
    }
    return {
      syncNeededCount: sync,
      pendingCount: pending,
      rejectedCount: rejected,
      criticalCount: critical,
      avgWait: pending > 0 ? Math.round(waitSum / pending) : 0,
    };
  }, [parentSubmissions]);
  const completedCount = useMemo(
    () => data.allSubmissions.filter(s => s.currentApprovalLevel === 'completed').length,
    [data.allSubmissions]
  );
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
      // Patch DB cache so next reload also reflects rejection
      fetch(`/api/submissions/${sub.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_level: sub.currentApprovalLevel, status: 'rejected', approver_name: currentUser.name, last_synced: new Date().toISOString() }),
      }).catch(() => {});
      setRejectReason('');
      setRejectingId(null);
      setRejectedIds(prev => new Set([...prev, sub.id]));
      setConfirmRejectId(null);
      // Staggered refresh — catches webhook delay (3s, 6s, 12s)
      data.scheduleRefreshAfterAction();
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...jotformHeaders() },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      // Clear needs_sync in DB
      fetch(`/api/submissions/${sub.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs_sync: false, last_synced: new Date().toISOString() }),
      }).catch(() => {});

      const newLevel = action === 'reject' ? 'rejected' as const
        : isLastLevel ? 'completed' as const
        : (lvl + 1) as 1 | 2 | 3 | 4;
      const newStatus = action === 'reject' ? 'Rejected' : isLastLevel ? 'Completed' : 'In Progress';
      data.optimisticUpdate(sub.id, { newLevel, newJotformStatus: newStatus, approverName: 'Synced via JotFlow', approvalDate: dateStr });
      addAuditEntry(sub.id, action === 'approve' ? 'approved' : 'rejected', 'JotFlow Sync', `Native JotForm action synced as ${action}`);

      setSyncSubmission(null);
      data.scheduleRefreshAfterAction();
    } catch (err) {
      alert(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleSort = useCallback((key: typeof sortKey) => {
    startTransition(() => {
      if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSortKey(key); setSortDir('desc'); }
    });
  }, [sortKey]);

  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => setSearch(value));
  }, []);

  const handleFilterLevelChange = useCallback((value: string) => {
    startTransition(() => setFilterLevel(value));
  }, []);

  const handleFilterDepartmentChange = useCallback((value: string) => {
    startTransition(() => setFilterDepartment(value));
  }, []);

  const handleFilterStatusChange = useCallback((value: string) => {
    startTransition(() => setFilterStatus(value));
  }, []);

  const handleFilterDateFromChange = useCallback((value: string) => {
    startTransition(() => setFilterDateFrom(value));
  }, []);

  const handleFilterDateToChange = useCallback((value: string) => {
    startTransition(() => setFilterDateTo(value));
  }, []);

  const handleFilterSubmittedByChange = useCallback((value: string) => {
    startTransition(() => setFilterSubmittedBy(value));
  }, []);

  const SortIcon = useCallback(({ field }: { field: typeof sortKey }) => (
    sortKey === field
      ? (sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />)
      : <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
  ), [sortKey, sortDir]);

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
        className="glass-card p-5 border border-gold/20 bg-gradient-to-r from-gold/5 to-transparent hidden"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">
              Welcome, {currentUser.name} — <span className="text-gold capitalize">{orgRole === 'super_admin' ? 'Super Admin' : orgRole}</span>
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {parentSubmissions.length > 0
                ? `${parentSubmissions.length} submission${parentSubmissions.length !== 1 ? 's' : ''} — ${pendingCount} pending, ${completedCount} completed, ${rejectedCount} rejected`
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
      <DashboardStats
        totalCount={parentSubmissions.length}
        pendingCount={pendingCount}
        completedCount={completedCount}
        rejectedCount={rejectedCount}
        criticalCount={criticalCount}
        syncNeededCount={syncNeededCount}
        approvedToday={approvedToday}
      />

      {/* Search + Assigned to Me */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by reference, title, submitter, or form type..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-navy-dark border border-navy-light/30 text-sm text-white placeholder-gray-600 focus:border-gold/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setAssignedToMe(!assignedToMe)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              assignedToMe
                ? 'bg-gold text-navy-dark border border-gold'
                : 'bg-navy-dark text-gray-400 border border-navy-light/30 hover:border-gold/50 hover:text-white'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Assigned to Me
          </button>
          <button
            onClick={() => setViewOnly(!viewOnly)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              viewOnly
                ? 'bg-gold text-navy-dark border border-gold'
                : 'bg-navy-dark text-gray-400 border border-navy-light/30 hover:border-gold/50 hover:text-white'
            }`}
          >
            <Eye className="w-4 h-4" />
            View Only
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              showFilters || activeFilterCount > 0
                ? 'bg-gold text-navy-dark border border-gold'
                : 'bg-navy-dark text-gray-400 border border-navy-light/30 hover:border-gold/50 hover:text-white'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button
            onClick={() => exportToExcel(parentSubmissions, 'jotflow-submissions')}
            disabled={parentSubmissions.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap bg-navy-dark text-blue-400 border border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export to Excel
          </button>
          {isViewer ? null : deleteConfirmId === 'all' ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30">
              <span className="text-xs text-red-400 whitespace-nowrap">Delete all {directorSubmissions.length} submissions?</span>
              <button
                onClick={handleDeleteAll}
                disabled={deletingId === 'all'}
                className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-500 disabled:opacity-50 flex items-center gap-1"
              >
                {deletingId === 'all' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Yes, Delete All
              </button>
              <button onClick={() => setDeleteConfirmId(null)} className="px-3 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-600">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirmId('all')}
              disabled={parentSubmissions.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap bg-navy-dark text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>
          )}
        </div>
      </motion.div>

      {/* Filter Panel */}
      <FilterPanel
        show={showFilters}
        onClose={() => setShowFilters(false)}
        uniqueLevels={uniqueLevels}
        uniqueDepartments={uniqueDepartments}
        uniqueSubmitters={uniqueSubmitters}
        filterLevel={filterLevel}
        filterDepartment={filterDepartment}
        filterStatus={filterStatus}
        filterDateFrom={filterDateFrom}
        filterDateTo={filterDateTo}
        filterSubmittedBy={filterSubmittedBy}
        activeFilterCount={activeFilterCount}
        onClear={clearAllFilters}
        onFilterLevelChange={handleFilterLevelChange}
        onFilterDepartmentChange={handleFilterDepartmentChange}
        onFilterStatusChange={handleFilterStatusChange}
        onFilterDateFromChange={handleFilterDateFromChange}
        onFilterDateToChange={handleFilterDateToChange}
        onFilterSubmittedByChange={handleFilterSubmittedByChange}
      />

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card overflow-hidden relative border-t-2 border-gold/40"
      >
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto w-full" style={{ scrollbarGutter: 'stable' }}>
          <table className="w-full table-fixed">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-navy-light/40 bg-gradient-to-r from-navy-dark/95 to-navy-dark/90 backdrop-blur-sm">
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest w-12">No.</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest hidden">Ref#</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Title / Form</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Submitted By</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest cursor-pointer select-none hover:text-gold transition-colors" onClick={() => toggleSort('currentApprovalLevel')}>
                  <div className="flex items-center gap-1">Level <SortIcon field="currentApprovalLevel" /></div>
                </th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pending With</th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest cursor-pointer select-none hidden hover:text-gold transition-colors" onClick={() => toggleSort('daysAtCurrentLevel')}>
                  <div className="flex items-center gap-1">Aging <SortIcon field="daysAtCurrentLevel" /></div>
                </th>
                <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3.5 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {parentSubmissions.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Shield className="w-10 h-10 text-emerald-400/50" />
                        <p className="text-gray-400">No submissions found</p>
                        <p className="text-xs text-gray-600">Try clearing your search or filters</p>
                      </div>
                    </td>
                  </tr>
                )}
                {paginatedSubmissions.map((sub, idx) => (
                  <React.Fragment key={sub.id}>
                  <motion.tr
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 50, height: 0 }}
                    transition={{ duration: 0.3 }}
                    onClick={() => openSidebarWithTasks(sub)}
                    className="border-b border-white/8 hover:bg-gold/5 transition-colors duration-200 cursor-pointer"
                  >
                    <td className="px-4 py-3.5 text-sm text-gray-400 font-mono">{(safeCurrentPage - 1) * rowsPerPage + idx + 1}</td>
                    <td className="px-4 py-3.5 hidden">
                      <div className="flex items-center gap-1.5">
                        {/* <button
                          onClick={() => toggleRowExpand(sub)}
                          className="p-0.5 rounded hover:bg-navy-light/20 text-gray-500 hover:text-gold transition-colors flex-shrink-0"
                          title={expandedRowId === sub.id ? 'Collapse' : 'Show workflow steps'}
                        >
                          {expandLoading === sub.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedRowId === sub.id ? 'rotate-90' : ''}`} />}
                        </button> */}
                        {/* <button
                          onClick={() => { toggleRowExpand(sub); setWorkflowModalSubmission(sub); }}
                          className="p-0.5 rounded hover:bg-navy-light/20 text-gray-500 hover:text-gold transition-colors flex-shrink-0"
                          title="View in modal"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button> */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openModal(sub); }}
                          className="text-sm font-bold text-gold hover:underline bg-navy-light/20 rounded-md px-2 py-0.5 inline-block"
                        >
                          {sub.referenceNumber.split('-').pop()}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {/* <button
                          onClick={() => toggleRowExpand(sub)}
                          className="p-0.5 rounded hover:bg-navy-light/20 text-gray-500 hover:text-gold transition-colors flex-shrink-0"
                          title={expandedRowId === sub.id ? 'Collapse' : 'Show workflow steps'}
                        >
                          {expandLoading === sub.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedRowId === sub.id ? 'rotate-90' : ''}`} />}
                        </button> */}
                        {/* <button
                          onClick={() => { toggleRowExpand(sub); setWorkflowModalSubmission(sub); }}
                          className="p-0.5 rounded hover:bg-navy-light/20 text-gray-500 hover:text-gold transition-colors flex-shrink-0"
                          title="View in modal"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button> */}
                        {/* <button
                          onClick={(e) => { e.stopPropagation(); openSidebarWithTasks(sub); }}
                          className="p-0.5 rounded hover:bg-navy-light/20 text-gray-500 hover:text-gold transition-colors flex-shrink-0"
                          title="View in sidebar"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                        </button> */}
                        <div>
                          <a
                            href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm text-white hover:text-gold hover:underline inline-flex items-center gap-1 group"
                          >
                            {sub.title}
                            <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-gold transition-colors" />
                          </a>
                          <p className="text-xs text-gray-500">{sub.formTitle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm text-gray-300">{sub.submittedBy.name}</p>
                      <p className="text-xs text-gray-500">{sub.submittedBy.department}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm text-gray-300">
                        {new Date(sub.submissionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <LevelBadge level={sub.currentApprovalLevel} />
                    </td>
                    <td className="px-4 py-3.5">
                      <PendingWithCell submission={sub} onSyncClick={setSyncSubmission} />
                    </td>
                    <td className="px-4 py-3.5 hidden">
                      <AgingCell days={sub.daysAtCurrentLevel} />
                    </td>
                    <td className="px-4 py-3.5">
                      <WorkflowStatusBadge submission={sub} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-1">
                        {isViewer && !(user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 text-xs font-medium inline-flex items-center gap-1 border border-gray-500/20">
                            <Eye className="w-3.5 h-3.5" /> View Only
                          </span>
                        ) : sub.currentApprovalLevel === 'completed' ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium inline-flex items-center gap-1 border border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approved & Completed
                          </span>
                        ) : sub.currentApprovalLevel === 'rejected' ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium inline-flex items-center gap-1 border border-red-500/20">
                            <XCircle className="w-3.5 h-3.5" /> Rejected
                          </span>
                        ) : viewOnly ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 text-xs font-medium inline-flex items-center gap-1 border border-gray-500/20">
                            <Eye className="w-3.5 h-3.5" /> View Only Mode
                          </span>
                        ) : sub.actionType === 'task' ? (
                          (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                            <button
                              onClick={() => openTaskUrl(sub)}
                              disabled={taskUrlLoading === sub.id}
                              className="px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/35 disabled:opacity-50 text-xs font-medium flex items-center gap-1 border border-gold/40 transition-colors shadow-sm"
                            >
                              {taskUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                              View Task
                            </button>
                          ) : (
                            <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title="This task is assigned to someone else">
                              <Lock className="w-3.5 h-3.5" /> Not assigned to you
                            </span>
                          )
                        ) : sub.actionType === 'form' ? (
                          (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                            <button
                              onClick={() => openFormUrl(sub)}
                              disabled={formUrlLoading === sub.id}
                              className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                            >
                              {formUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileEdit className="w-3.5 h-3.5" />}
                              Complete Form
                            </button>
                          ) : (
                            <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title="This form is assigned to someone else">
                              <Lock className="w-3.5 h-3.5" /> Not assigned to you
                            </span>
                          )
                        ) : (
                          <>
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {typeof sub.currentApprovalLevel === 'number' && (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                                <button
                                  onClick={() => openModal(sub)}
                                  disabled={actionLoading === sub.id}
                                  className="px-2 py-1 text-xs font-medium text-gold hover:text-amber-300 disabled:opacity-50 transition-colors"
                                  title={"Review & Approve"}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {"Review & Approve"}
                                </button>
                              ) : typeof sub.currentApprovalLevel === 'number' ? (
                                <span className="px-2 py-1 text-xs font-medium text-gray-500 flex items-center gap-1" title={`Your role cannot approve Level ${sub.currentApprovalLevel}`}>
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
                                  className="px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Reject
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
                  {/* Expanded workflow steps timeline */}
                  {expandedRowId === sub.id && (
                    <tr className="bg-navy-dark/30">
                      <td colSpan={10} className="px-4 py-4 pl-10 overflow-hidden">
                        {expandedTasks.length === 0 ? (
                          <span className="text-xs text-gray-500 italic">No workflow steps found</span>
                        ) : (
                          <div className="w-full max-w-full overflow-x-hidden">
                            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-3">Workflow Steps</p>
                            <div className="space-y-0 max-w-full">
                              {expandedTasks.map((task, idx) => {
                                const isCompleted = task.status === 'COMPLETED';
                                const isActive = task.status === 'ACTIVE';
                                const isPending = task.status === 'PENDING';
                                const isLast = idx === expandedTasks.length - 1;
                                const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                                const typeBadge = task.type === 'workflow_approval' ? 'Approval'
                                  : task.type === 'workflow_assign_task' ? 'Task'
                                  : task.type === 'workflow_assign_form' ? 'Form' : task.type;

                                return (
                                  <div key={task.taskId || idx} className="flex items-start gap-3">
                                    {/* Timeline dot + connector */}
                                    <div className="flex flex-col items-center flex-shrink-0" style={{ minWidth: '16px' }}>
                                      {isCompleted ? (
                                        <div className="w-3 h-3 rounded-full bg-emerald-500 mt-1.5" />
                                      ) : isActive ? (
                                        <div className="w-3 h-3 rounded-full bg-gold mt-1.5 animate-pulse" />
                                      ) : (
                                        <div className="w-3 h-3 rounded-full border-2 border-gray-600 mt-1.5" />
                                      )}
                                      {!isLast && (
                                        <div className={`w-0.5 flex-1 min-h-[24px] ${isCompleted ? 'bg-emerald-500/40' : 'bg-gray-700'}`} />
                                      )}
                                    </div>

                                    {/* Step info */}
                                    <div className="flex-1 flex items-start justify-between pb-3 min-w-0">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={`text-sm font-medium ${isCompleted ? 'text-gray-400' : isActive ? 'text-white' : 'text-gray-500'}`}>
                                            {task.name}
                                          </span>
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                            task.type === 'workflow_approval' ? 'bg-purple-500/20 text-purple-400' :
                                            task.type === 'workflow_assign_form' ? 'bg-blue-500/20 text-blue-400' :
                                            'bg-amber-500/20 text-amber-400'
                                          }`}>
                                            {typeBadge}
                                          </span>
                                        </div>
                                        {task.assigneeName && (
                                          <p className="text-xs text-gray-500 mt-0.5">{task.assigneeName}{task.assigneeEmail ? ` (${task.assigneeEmail})` : ''}</p>
                                        )}
                                      </div>

                                      {/* Action area */}
                                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-3 flex-wrap">
                                        {isCompleted ? (
                                          <div className="flex items-center gap-1.5">
                                            <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium flex items-center gap-1 border border-emerald-500/20 shadow-sm">
                                              <CheckCircle2 className="w-3 h-3" /> Completed
                                            </span>
                                            {task.type === 'workflow_approval' && (
                                              <button
                                                onClick={() => fetchAndShowSignature(sub.id, task.level, task.taskId)}
                                                disabled={sigLoading === task.taskId}
                                                className="px-2 py-1 rounded-md bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 text-xs font-medium flex items-center gap-1 border border-purple-500/20 transition-colors disabled:opacity-50 shadow-sm"
                                              >
                                                {sigLoading === task.taskId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                                                View Sig
                                              </button>
                                            )}
                                          </div>
                                        ) : isPending ? (
                                          <span className="px-2 py-1 rounded-md bg-gray-500/10 text-gray-500 text-xs font-medium flex items-center gap-1 border border-gray-500/10">
                                            <Clock className="w-3 h-3" /> Waiting
                                          </span>
                                        ) : isActive && task.type === 'workflow_approval' ? (
                                          emailMatch ? (
                                            <div className="flex items-center gap-1.5">
                                              {taskConfirmRejectId === task.taskId ? (
                                                <div className="flex items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1">
                                                  <span className="text-[11px] text-red-400">Confirm reject?</span>
                                                  <button
                                                    onClick={() => { if (expandedRowId) handleTaskReject(expandedRowId, taskRejectReason.trim()); }}
                                                    disabled={taskActionLoading === expandedRowId}
                                                    className="px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-500 disabled:opacity-50 flex items-center gap-1"
                                                  >
                                                    {taskActionLoading === expandedRowId ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                                    Yes
                                                  </button>
                                                  <button onClick={() => { setTaskConfirmRejectId(null); setTaskRejectReason(''); setTaskRejectingId(null); }} className="px-2 py-0.5 rounded bg-gray-700 text-gray-300 text-xs hover:bg-gray-600">No</button>
                                                </div>
                                              ) : taskRejectingId === task.taskId ? (
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="text"
                                                    value={taskRejectReason}
                                                    onChange={e => setTaskRejectReason(e.target.value)}
                                                    placeholder="Reason (optional)"
                                                    className="bg-navy-dark/50 border border-red-500/30 rounded px-2 py-0.5 text-xs text-gray-300 w-36 focus:outline-none focus:border-red-500/60"
                                                    onKeyDown={e => { if (e.key === 'Enter') setTaskConfirmRejectId(task.taskId); }}
                                                  />
                                                  <button onClick={() => setTaskConfirmRejectId(task.taskId)} className="px-2 py-0.5 rounded bg-red-600/80 text-white text-xs hover:bg-red-500">OK</button>
                                                  <button onClick={() => { setTaskRejectingId(null); setTaskRejectReason(''); }} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                                                </div>
                                              ) : (
                                                <>
                                                  <button
                                                    onClick={() => { if (expandedRowId) handleTaskApprove(expandedRowId); }}
                                                    disabled={taskActionLoading === expandedRowId}
                                                    className="px-2.5 py-1 rounded-md bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                                                  >
                                                    {taskActionLoading === expandedRowId ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                                    Approve
                                                  </button>
                                                  <button
                                                    onClick={() => setTaskRejectingId(task.taskId)}
                                                    disabled={taskActionLoading === expandedRowId}
                                                    className="px-2.5 py-1 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                                                  >
                                                    <XCircle className="w-3 h-3" /> Reject
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="px-2 py-1 rounded-md bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title="This step is assigned to someone else">
                                              <Lock className="w-3 h-3" /> Not assigned to you
                                            </span>
                                          )
                                        ) : isActive && task.type === 'workflow_assign_task' ? (
                                          emailMatch ? (
                                            <button
                                              onClick={() => openTaskLink(task)}
                                              disabled={!task.accessLink}
                                              className="px-2.5 py-1 rounded-md bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                                              title={!task.accessLink ? 'Link unavailable' : ''}
                                            >
                                              <ClipboardList className="w-3 h-3" /> View Task
                                            </button>
                                          ) : (
                                            <span className="px-2 py-1 rounded-md bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title="This step is assigned to someone else">
                                              <Lock className="w-3 h-3" /> Not assigned to you
                                            </span>
                                          )
                                        ) : isActive && task.type === 'workflow_assign_form' ? (
                                          emailMatch ? (
                                            <button
                                              onClick={() => openTaskLink(task)}
                                              disabled={!task.accessLink}
                                              className="px-2.5 py-1 rounded-md bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 text-xs font-medium flex items-center gap-1 transition-colors"
                                              title={!task.accessLink ? 'Link unavailable' : ''}
                                            >
                                              <FileEdit className="w-3 h-3" /> Complete Form
                                            </button>
                                          ) : (
                                            <span className="px-2 py-1 rounded-md bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center gap-1 border border-gray-500/10" title="This step is assigned to someone else">
                                              <Lock className="w-3 h-3" /> Not assigned to you
                                            </span>
                                          )
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Child form submissions derived from workflow tasks */}
                        {(() => {
                          const childTasks = expandedTasks.filter(t =>
                            t.type === 'workflow_assign_task' || t.type === 'workflow_assign_form'
                          );
                          if (childTasks.length === 0) return null;
                          return (
                            <div className="mt-4 border-t border-navy-light/20 pt-3">
                              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                                Child Forms in this Workflow
                              </p>
                              <div className="rounded-lg border border-navy-light/20 overflow-hidden">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-navy-dark/40 border-b border-navy-light/20">
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase w-10">#</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Form Name</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Type</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Assigned To</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Submission Data</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Level</th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">Status</th>
                                      <th className="px-3 py-2 text-center text-[10px] font-bold text-gray-500 uppercase">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {childTasks.map((task, childIdx) => {
                                      const isCompleted = task.status === 'COMPLETED';
                                      const isActive = task.status === 'ACTIVE';
                                      const typeBadge = task.type === 'workflow_assign_task' ? 'Task' : 'Form';
                                      const emailMatch = user?.email && task.assigneeEmail?.toLowerCase() === user.email.toLowerCase();
                                      return (
                                        <tr key={task.taskId || childIdx} className="border-b border-navy-light/10 last:border-b-0 bg-navy-dark/20 hover:bg-navy-light/5 border-l-2 border-l-gold/30">
                                          <td className="px-3 py-2 text-xs text-gray-500 font-mono">{childIdx + 1}</td>
                                          <td className="px-3 py-2">
                                            <p className="text-xs text-gray-300">{task.name}</p>
                                          </td>
                                          <td className="px-3 py-2">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                              typeBadge === 'Task'
                                                ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20'
                                                : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                                            }`}>{typeBadge}</span>
                                          </td>
                                          <td className="px-3 py-2">
                                            <p className="text-xs text-gray-300">{task.assigneeName}</p>
                                            <p className="text-[10px] text-gray-500">{task.assigneeEmail}</p>
                                          </td>
                                          <td className="px-3 py-2">
                                            {task.formData && Object.keys(task.formData).length > 0 ? (
                                              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                                                {Object.values(task.formData).map((field, fi) => (
                                                  <p key={fi} className="text-[10px] text-gray-300 truncate max-w-[200px]" title={`${field.label}: ${field.value}`}>
                                                    <span className="text-gray-500">{field.label}:</span> {field.value}
                                                  </p>
                                                ))}
                                              </div>
                                            ) : task.submittedBy ? (
                                              <>
                                                <p className="text-[10px] text-gray-300">{task.submittedBy}</p>
                                                {task.submittedByEmail && <p className="text-[10px] text-gray-500">{task.submittedByEmail}</p>}
                                              </>
                                            ) : (
                                              <span className="text-[10px] text-gray-500 italic">—</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2">
                                            <LevelBadge level={task.level} />
                                          </td>
                                          <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                              isCompleted ? 'bg-emerald-500/15 text-emerald-400' :
                                              isActive ? 'bg-amber-500/15 text-amber-400' :
                                              'bg-gray-500/15 text-gray-400'
                                            }`}>
                                              {task.status === 'COMPLETED' ? 'Completed' : task.status === 'ACTIVE' ? 'Active' : 'Pending'}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            {isActive && emailMatch && task.accessLink ? (
                                              <a
                                                href={task.accessLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-gold hover:underline inline-flex items-center gap-1"
                                              >
                                                {typeBadge === 'Task' ? (
                                                  <><ClipboardList className="w-3 h-3" /> View Task</>
                                                ) : (
                                                  <><FileEdit className="w-3 h-3" /> Complete Form</>
                                                )}
                                              </a>
                                            ) : isCompleted ? (
                                              <span className="text-[10px] text-gray-500">Done</span>
                                            ) : (
                                              <span className="text-[10px] text-gray-500">—</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()}
                        {/* Form Submission Data (JotForm Tables) */}
                        {sub.formTableData && sub.formTableData.length > 0 && (
                          <div className="mt-4 border-t border-navy-light/20 pt-3">
                            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                              Form Submission Data
                            </p>
                            <div className="rounded-lg border border-navy-light/20 overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="bg-navy-dark/40 border-b border-navy-light/20">
                                    {sub.formTableData.map((field, i) => (
                                      <th key={i} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">
                                        {field.label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-b border-navy-light/10">
                                    {sub.formTableData.map((field, i) => (
                                      <td key={i} className="px-3 py-2 text-xs text-gray-300 whitespace-nowrap">
                                        {field.value || '—'}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Mobile Card Layout */}
        <div className="md:hidden space-y-3 p-4">
          {parentSubmissions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Shield className="w-10 h-10 text-emerald-400/50" />
              <p className="text-gray-400">No submissions found</p>
              <p className="text-xs text-gray-600">Try clearing your search or filters</p>
            </div>
          ) : (
            <AnimatePresence>
              {paginatedSubmissions.map((sub, idx) => (
                <motion.div
                  key={sub.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="border border-navy-light/30 rounded-lg bg-navy-dark/40 p-4 space-y-3"
                >
                  {/* Header: Ref# and Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-gold">{sub.referenceNumber}</p>
                      <p className="text-xs text-gray-400">{sub.formTitle}</p>
                    </div>
                    <LevelBadge level={sub.currentApprovalLevel} />
                  </div>

                  {/* Title */}
                  <div>
                    <a
                      href={`https://eforms.mediaoffice.ae/inbox/${sub.formId}/${sub.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-white hover:text-gold hover:underline inline-flex items-center gap-1 group"
                    >
                      {sub.title}
                      <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-gold transition-colors" />
                    </a>
                  </div>

                  {/* Submitted By */}
                  <div className="text-xs space-y-1 border-t border-navy-light/20 pt-2">
                    <p className="text-gray-400">
                      <span className="font-semibold">By:</span> {sub.submittedBy.name}
                    </p>
                    <p className="text-gray-500">
                      <span className="font-semibold">Dept:</span> {sub.submittedBy.department}
                    </p>
                    <p className="text-gray-500">
                      <span className="font-semibold">Date:</span> {new Date(sub.submissionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Pending With */}
                  <div className="text-xs border-t border-navy-light/20 pt-2">
                    <p className="text-gray-400 font-semibold mb-1">Pending With:</p>
                    <PendingWithCell submission={sub} onSyncClick={setSyncSubmission} />
                  </div>

                  {/* Status */}
                  <div className="text-xs border-t border-navy-light/20 pt-2">
                    <WorkflowStatusBadge submission={sub} />
                  </div>

                  {/* Actions */}
                  <div className="border-t border-navy-light/20 pt-3 space-y-2">
                    {isViewer && !(user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 text-xs font-medium inline-flex items-center gap-1 border border-gray-500/20 w-full justify-center">
                        <Eye className="w-3 h-3" /> View Only
                      </span>
                    ) : sub.currentApprovalLevel === 'completed' ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium inline-flex items-center gap-1 border border-emerald-500/20 w-full justify-center">
                        <CheckCircle2 className="w-3 h-3" /> Completed
                      </span>
                    ) : sub.currentApprovalLevel === 'rejected' ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium inline-flex items-center gap-1 border border-red-500/20 w-full justify-center">
                        <XCircle className="w-3 h-3" /> Rejected
                      </span>
                    ) : viewOnly ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 text-xs font-medium inline-flex items-center gap-1 border border-gray-500/20 w-full justify-center">
                        <Eye className="w-3 h-3" /> View Only
                      </span>
                    ) : sub.actionType === 'task' ? (
                      (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                        <button
                          onClick={() => openTaskUrl(sub)}
                          disabled={taskUrlLoading === sub.id}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                        >
                          {taskUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                          View Task
                        </button>
                      ) : (
                        <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center justify-center gap-1 border border-gray-500/10 w-full">
                          <Lock className="w-3.5 h-3.5" /> Not assigned
                        </span>
                      )
                    ) : sub.actionType === 'form' ? (
                      (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                        <button
                          onClick={() => openFormUrl(sub)}
                          disabled={formUrlLoading === sub.id}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                        >
                          {formUrlLoading === sub.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileEdit className="w-3.5 h-3.5" />}
                          Complete Form
                        </button>
                      ) : (
                        <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center justify-center gap-1 border border-gray-500/10 w-full">
                          <Lock className="w-3.5 h-3.5" /> Not assigned
                        </span>
                      )
                    ) : (
                      <div className="space-y-2">
                        {typeof sub.currentApprovalLevel === 'number' && (user?.email && sub.pendingApproverEmail?.toLowerCase() === user.email.toLowerCase()) ? (
                          <button
                            onClick={() => openModal(sub)}
                            disabled={actionLoading === sub.id}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Review & Approve
                          </button>
                        ) : typeof sub.currentApprovalLevel === 'number' ? (
                          <span className="px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium flex items-center justify-center gap-1 border border-gray-500/10 w-full">
                            <Lock className="w-3.5 h-3.5" /> Not your level
                          </span>
                        ) : null}

                        {confirmRejectId === sub.id ? (
                          <div className="flex flex-col gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2 py-1.5">
                            <span className="text-[11px] text-red-400">Confirm reject?</span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleReject(sub)}
                                disabled={actionLoading === sub.id}
                                className="flex-1 px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-500 disabled:opacity-50"
                              >
                                Yes
                              </button>
                              <button onClick={() => { setConfirmRejectId(null); setRejectingId(sub.id); }} className="flex-1 px-1 py-0.5 text-xs text-gray-500 hover:text-gray-300">
                                No
                              </button>
                            </div>
                          </div>
                        ) : rejectingId === sub.id ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              placeholder="Reason..."
                              autoFocus
                              className="w-full px-2 py-1 text-xs rounded bg-navy-dark border border-red-500/30 text-white placeholder-gray-600 focus:outline-none"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => setConfirmRejectId(sub.id)}
                                className="flex-1 px-2 py-1 rounded bg-red-500/30 text-red-400 text-xs hover:bg-red-500/40"
                              >
                                OK
                              </button>
                              <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="flex-1 px-1 py-1 text-xs text-gray-500 hover:text-gray-300">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRejectingId(sub.id)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium flex items-center justify-center gap-1 border border-red-500/20 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Reject
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* View Detail — opens WorkflowDetailsModal popup */}
                  <button
                    onClick={() => openWorkflowModal(sub)}
                    className="w-full px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gold hover:bg-navy-light/20 transition-colors flex items-center justify-center gap-1"
                  >
                    {expandLoading === sub.id ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" /> View Detail
                      </>
                    )}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer with Pagination */}
        <PaginationFooter
          totalCount={parentSubmissions.length}
          currentPage={safeCurrentPage}
          rowsPerPage={rowsPerPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
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
            // Staggered refresh — catches webhook delay (3s, 6s, 12s)
            data.scheduleRefreshAfterAction();
          }}
        />
      )}

      {/* Workflow Details Modal */}
      <AnimatePresence>
        {workflowModalSubmission && (
          <WorkflowDetailsModal
            submission={workflowModalSubmission}
            expandedTasks={expandedTasks}
            expandLoading={expandLoading || undefined}
            taskActionLoading={taskActionLoading || undefined}
            taskRejectingId={taskRejectingId}
            taskRejectReason={taskRejectReason}
            taskConfirmRejectId={taskConfirmRejectId}
            sigLoading={sigLoading || undefined}
            user={user}
            onClose={() => setWorkflowModalSubmission(null)}
            onTaskApprove={(submissionId) => handleTaskApprove(submissionId)}
            onTaskReject={(submissionId, reason) => handleTaskReject(submissionId, reason)}
            onFetchSignature={fetchAndShowSignature}
            onOpenTaskLink={openTaskLink}
            onSetTaskRejecting={setTaskRejectingId}
            onSetTaskRejectReason={setTaskRejectReason}
            onSetTaskConfirmReject={setTaskConfirmRejectId}
          />
        )}
      </AnimatePresence>

      {/* Workflow Details Sidebar */}
      <WorkflowDetailsSidebar
        isOpen={!!workflowSidebarSubmission}
        submission={workflowSidebarSubmission}
        expandedTasks={expandedTasks}
        expandLoading={expandLoading || undefined}
        taskActionLoading={taskActionLoading || undefined}
        taskRejectingId={taskRejectingId}
        taskRejectReason={taskRejectReason}
        taskConfirmRejectId={taskConfirmRejectId}
        sigLoading={sigLoading || undefined}
        user={user}
        onClose={() => setWorkflowSidebarSubmission(null)}
        onTaskApprove={(submissionId) => { if (workflowSidebarSubmission) openModal(workflowSidebarSubmission); }}
        onTaskReject={(submissionId, reason) => { if (workflowSidebarSubmission) { setRejectingId(workflowSidebarSubmission.id); openModal(workflowSidebarSubmission); } }}
        onFetchSignature={fetchAndShowSignature}
        onOpenTaskLink={openTaskLink}
        onSetTaskRejecting={setTaskRejectingId}
        onSetTaskRejectReason={setTaskRejectReason}
        onSetTaskConfirmReject={setTaskConfirmRejectId}
      />

      {/* Sync Confirmation Modal */}
      <SyncConfirmModal
        submission={syncSubmission}
        loading={syncLoading}
        onConfirm={handleSyncConfirm}
        onClose={() => setSyncSubmission(null)}
      />

      {/* Signature Viewer Modal */}
      <SignatureViewerModal data={viewSignature} onClose={() => setViewSignature(null)} />

    </div>
  );
}
