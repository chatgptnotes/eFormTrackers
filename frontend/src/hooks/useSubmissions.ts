import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Submission, ApprovalEntry, ApprovalLevel, FilterConfig, SortConfig, PaginationConfig, RefreshConfig, WorkflowActionType } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/mockData';
import { apiFetch } from '../lib/api';
import { io, Socket } from 'socket.io-client';
import type { JFFormMeta } from '../services/formDiscovery';

// ─── Workflow step type cache (per formId) ────────────────────────────────────
interface WorkflowStep { level: number; type: WorkflowActionType; assigneeEmail?: string; }

// ─── Aging thresholds ────────────────────────────────────────────────────────
const AGING_WARN_DAYS = 3;
const AGING_CRITICAL_DAYS = 7;
function agingStatus(days: number): 'on-track' | 'delayed' | 'critical' {
  return days > AGING_CRITICAL_DAYS ? 'critical' : days > AGING_WARN_DAYS ? 'delayed' : 'on-track';
}

// ─── Parse approver name/email from JotFlow action text ─────────────────────
// Action text format: "Action: Approved | By: Murali BK (bk@bettroi.com) | Via: JotFlow | Date: ..."
function parseApproverFromActionText(text: string): { name: string; email: string } | null {
  if (!text) return null;
  const match = text.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  const nameOnly = text.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
  if (nameOnly) return { name: nameOnly[1].trim(), email: '' };
  return null;
}

// ─── Map a Supabase row back to a Submission ──────────────────────────────────
function mapSupabaseRow(row: Record<string, unknown>): Submission {
  const raw = (row.raw_data as Record<string, unknown>) || {};

  const mapped = (raw._mapped as Record<string, unknown>) || {};
  const levelHistory = (row.level_history as Array<Record<string, unknown>>) || (mapped.levels as Array<Record<string, unknown>>) || [];
  const history: ApprovalEntry[] = levelHistory.map(l => {
    const levelNum = Number(l.id ?? l.level ?? 0);
    const approverRaw = String(l.approver ?? l.approverName ?? '');
    const parsed = parseApproverFromActionText(approverRaw);
    return {
      level: levelNum as ApprovalLevel,
      approverName: parsed?.name || (approverRaw && !approverRaw.includes('Action:') ? approverRaw : '') || `Level ${levelNum} Approver`,
      approverEmail: parsed?.email || String(l.approverEmail ?? ''),
      status: (String(l.status ?? '').toLowerCase() === 'approved' ? 'approved' : String(l.status ?? '').toLowerCase() === 'rejected' ? 'rejected' : 'pending') as 'approved' | 'rejected' | 'pending',
      date: String(l.date ?? '') || undefined,
    };
  });

  const totalDays = Number(row.total_days) || 0;
  const status = String(row.status || 'pending');
  const currentLevel: ApprovalLevel | 'completed' | 'rejected' =
    status === 'completed' ? 'completed' : status === 'rejected' ? 'rejected' : (Number(row.current_level) || 1) as ApprovalLevel;

  const sbId = String(row.jotform_submission_id);
  const sbFormId = String(row.form_id || '');

  const pendingApproverName = String(row.pending_approver_name || '') || undefined;
  const pendingApproverEmail = String(row.pending_approver_email || '') || undefined;
  const submitterEmail = String(row.submitter_email || (mapped.email as string) || '');

  if (pendingApproverName) {
    const pendingEntry = history.find(h => h.status === 'pending');
    if (pendingEntry && (pendingEntry.approverName.startsWith('Level ') || !pendingEntry.approverName)) {
      pendingEntry.approverName = pendingApproverName;
      pendingEntry.approverEmail = pendingApproverEmail;
    }
  }

  const sbFormTitle = String(row.form_title || row.title || 'Form');
  const sbPrefix = sbFormTitle.split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3) || 'F';

  return {
    id: sbId,
    formId: sbFormId,
    formTitle: sbFormTitle,
    referenceNumber: `${sbPrefix}-${sbId.slice(-6)}`,
    title: String(row.title || 'Request'),
    description: String(row.description || row.title || 'Request'),
    editLink: String(row.edit_link || '') || undefined,
    actionType: 'approval' as WorkflowActionType,
    taskUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    formUrl: `https://eforms.mediaoffice.ae/inbox/${sbFormId}/${sbId}`,
    submittedBy: {
      name: String(row.submitter_name || row.submitted_by || 'Unknown'),
      department: String(row.department || 'General'),
      email: submitterEmail,
    },
    submissionDate: String(row.submission_date || new Date().toISOString()).slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel: totalDays,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(totalDays),
    jotformStatus: String(row.jotform_status || row.status || (currentLevel === 'completed' ? 'Completed' : currentLevel === 'rejected' ? 'Rejected' : 'Pending')),
    priority: (String(row.priority || 'medium') as 'low' | 'medium' | 'high' | 'urgent'),
    answers: (row.answers as Record<string, string>) || { description: String(row.title || ''), amount: String(row.amount || (mapped.amount as string) || ''), department: String(row.department || ''), email: submitterEmail, requester: String(row.submitted_by || '') },
    pendingApproverName,
    pendingApproverEmail,
    approvalUrl: String(row.approval_url || '') || undefined,
    workflowInstanceId: String(row.workflow_instance_id || '') || undefined,
  } as Submission;
}

// ─── Backend URL for Socket.IO connection ─────────────────────────────────────
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubmissions() {
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshConfig, setRefreshConfig] = useState<RefreshConfig>({
    autoRefresh: true,
    intervalMinutes: 1,
    lastUpdated: null,
  });

  const [filters, setFilters] = useState<FilterConfig>(() => {
    try {
      const saved = localStorage.getItem('jotflow_filters');
      return saved ? { ...{ approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }, ...JSON.parse(saved) } : { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' };
    } catch { return { approvalLevel: '', department: '', status: '', dateFrom: '', dateTo: '', search: '' }; }
  });
  const wrappedSetFilters = (updater: FilterConfig | ((prev: FilterConfig) => FilterConfig)) => {
    setFilters(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('jotflow_filters', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const [sort, setSort] = useState<SortConfig>({ key: 'submissionDate', direction: 'desc' });
  const [pagination, setPagination] = useState<PaginationConfig>({ page: 1, perPage: 25, total: 0 });

  // ─── Action cooldown: prevent real-time refresh from overwriting optimistic updates ──
  const actionCooldownUntil = React.useRef<number>(0);

  const startActionCooldown = useCallback((durationMs = 4000) => {
    actionCooldownUntil.current = Date.now() + durationMs;
  }, []);

  // ─── Read submissions exclusively from DB (poller keeps it fresh) ────────────
  const loadFromSupabase = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() < actionCooldownUntil.current) return;

    try {
      setLoading(prev => {
        // Only show loading spinner on first load (when no data yet)
        return allSubmissions.length === 0 ? true : prev;
      });
      const data = await apiFetch<Record<string, unknown>[]>(
        `/api/submissions?limit=2000&order=desc`
      );
      if (!data || data.length === 0) {
        setLoading(false);
        return;
      }

      const mapped = data.map(row => mapSupabaseRow(row as Record<string, unknown>));
      setAllSubmissions(mapped);
      setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
    } catch (err) {
      console.warn('[useSubmissions] DB read failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [allSubmissions.length]);

  // ─── On mount: load from DB ────────────────────────────────────────────────
  useEffect(() => {
    loadFromSupabase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Socket.IO: receive submissions:updated from backend poller ─────────────
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('submissions:updated', () => {
      loadFromSupabase();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadFromSupabase]);

  // ─── Polling fallback — 30s interval in case Socket.IO misses an event ──────
  useEffect(() => {
    const interval = setInterval(loadFromSupabase, 30_000);
    return () => clearInterval(interval);
  }, [loadFromSupabase]);

  // ─── Auto-refresh ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!refreshConfig.autoRefresh) return;
    const interval = setInterval(loadFromSupabase, refreshConfig.intervalMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshConfig.autoRefresh, refreshConfig.intervalMinutes, loadFromSupabase]);

  // ─── Filtering / sorting / pagination ─────────────────────────────────────
  const filteredSubmissions = useMemo(() => {
    let result = [...allSubmissions];
    if (filters.approvalLevel) {
      const level = filters.approvalLevel === 'completed' ? 'completed'
        : filters.approvalLevel === 'rejected' ? 'rejected'
        : Number(filters.approvalLevel);
      result = result.filter(s => s.currentApprovalLevel === level);
    }
    if (filters.department) result = result.filter(s => s.submittedBy.department === filters.department);
    if (filters.status) result = result.filter(s => s.jotformStatus?.toLowerCase().includes(filters.status.toLowerCase()));
    if (filters.dateFrom) result = result.filter(s => s.submissionDate >= filters.dateFrom);
    if (filters.dateTo) result = result.filter(s => s.submissionDate <= filters.dateTo);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.referenceNumber.toLowerCase().includes(q) ||
        s.submittedBy.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.formId.toLowerCase().includes(q) ||
        s.formTitle.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.key];
      const bVal = (b as unknown as Record<string, unknown>)[sort.key];
      const cmp = String(aVal || '').localeCompare(String(bVal || ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [allSubmissions, filters, sort]);

  useEffect(() => {
    setPagination(prev => ({ ...prev, total: filteredSubmissions.length, page: 1 }));
  }, [filteredSubmissions.length]);

  const paginatedSubmissions = useMemo(() => {
    const start = (pagination.page - 1) * pagination.perPage;
    return filteredSubmissions.slice(start, start + pagination.perPage);
  }, [filteredSubmissions, pagination.page, pagination.perPage]);

  const stats = useMemo(() => getDashboardStats(allSubmissions), [allSubmissions]);
  const approvalStats = useMemo(() => getApprovalLevelStats(allSubmissions), [allSubmissions]);
  const departmentStats = useMemo(() => getDepartmentStats(allSubmissions), [allSubmissions]);
  const trendData = useMemo(() => getTrendData(allSubmissions), [allSubmissions]);
  const bottleneckData = useMemo(() => getBottleneckData(allSubmissions), [allSubmissions]);
  const heatmapData = useMemo(() => getHeatmapData(allSubmissions), [allSubmissions]);

  // ─── Workflow step cache (for optimistic updates) ─────────────────────────
  const [stepsByForm] = useState<Record<string, WorkflowStep[]>>({});

  // ─── Optimistic update: immediately patch a submission in state ─────────────
  const optimisticUpdate = useCallback((
    submissionId: string,
    patch: {
      newLevel?: ApprovalLevel | 'completed' | 'rejected';
      newJotformStatus?: string;
      approverName?: string;
      approvalDate?: string;
    }
  ) => {
    setAllSubmissions(prev => prev.map(sub => {
      if (sub.id !== submissionId) return sub;

      const updatedHistory = [...sub.approvalHistory];
      const currentLvl = sub.currentApprovalLevel;

      if (patch.newLevel !== undefined && typeof currentLvl === 'number') {
        const histIdx = updatedHistory.findIndex(h => h.level === currentLvl);
        const isRejected = patch.newLevel === 'rejected';
        const entry = {
          level: currentLvl as ApprovalLevel,
          approverName: patch.approverName || updatedHistory[histIdx]?.approverName || `Level ${currentLvl} Approver`,
          status: (isRejected ? 'rejected' : 'approved') as 'approved' | 'rejected' | 'pending',
          date: patch.approvalDate || new Date().toISOString().slice(0, 10),
        };
        if (histIdx >= 0) updatedHistory[histIdx] = entry;
        else updatedHistory.push(entry);

        if (!isRejected && patch.newLevel !== 'completed' && typeof patch.newLevel === 'number') {
          const nextLvl = patch.newLevel as ApprovalLevel;
          const nextExists = updatedHistory.findIndex(h => h.level === nextLvl);
          const formSteps = stepsByForm[sub.formId] || [];
          const nextStep = formSteps.find(s => s.level === nextLvl);
          const nextApprover = nextStep?.assigneeEmail || `Level ${nextLvl} Approver`;
          if (nextExists < 0) updatedHistory.push({ level: nextLvl, approverName: nextApprover, status: 'pending' });
        }
      }

      return {
        ...sub,
        currentApprovalLevel: patch.newLevel ?? sub.currentApprovalLevel,
        jotformStatus: patch.newJotformStatus ?? sub.jotformStatus,
        approvalHistory: updatedHistory,
        daysAtCurrentLevel: 0,
      };
    }));
  }, [stepsByForm]);

  // ─── Schedule staggered refresh after an action (catches webhook delay) ─────
  const scheduleRefreshAfterAction = useCallback(() => {
    startActionCooldown(4000);
    const timers = [3000, 6000, 12000].map(ms =>
      setTimeout(() => loadFromSupabase({ force: true }), ms)
    );
    return () => timers.forEach(t => clearTimeout(t));
  }, [loadFromSupabase, startActionCooldown]);

  return {
    allSubmissions, filteredSubmissions, paginatedSubmissions,
    activeForms: [] as JFFormMeta[],
    loading, error,
    stats, approvalStats, departmentStats, trendData, bottleneckData, heatmapData,
    filters, setFilters: wrappedSetFilters,
    sort, setSort,
    pagination, setPagination,
    refreshConfig, setRefreshConfig,
    refresh: loadFromSupabase,
    refreshFromSupabase: loadFromSupabase,
    optimisticUpdate,
    scheduleRefreshAfterAction,
  };
}
