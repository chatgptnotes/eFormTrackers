import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Submission, ApprovalLevel, FilterConfig, SortConfig, PaginationConfig, RefreshConfig } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/submissionStats';
import { apiFetch } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { io, Socket } from 'socket.io-client';
import { JFFormMeta } from '../services/formDiscovery';
import { WorkflowStep, clearWorkflowStepCache, clearWorkflowTaskCache } from './workflowTaskCache';
import { clearApproverConfigCache } from './useApproverConfig';
import { mapSupabaseRow } from './submissionMappers';
import { loadAndEnrichSubmissions, deltaSyncToSupabase } from './submissionLoader';
import { getJotformKeyType } from '../lib/jotformKey';
import { useToast } from '../components/ToastNotification';
import { useAuth } from '../contexts/AuthContext';

// ─── Workspace version — bump when switching teams to force full cache clear ──
const WORKSPACE_VERSION = 'gdmo-bettroi-v4'; // bumped: new API key — force cache clear
const WS_VERSION_KEY = 'jotflow_workspace_version';

function checkAndClearWorkspaceCaches() {
  const stored = localStorage.getItem(WS_VERSION_KEY);
  if (stored !== WORKSPACE_VERSION) {
    // Workspace changed — nuke ALL jotflow_* caches so no stale data shows
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('jotflow_')) localStorage.removeItem(k);
    });
    localStorage.setItem(WS_VERSION_KEY, WORKSPACE_VERSION);
    clearWorkflowStepCache();
  }
  // One-shot migration: drop pre-keyType-scoped caches so old default-key data
  // never paints when the user is on gdmo (and vice versa).
  if (localStorage.getItem('jotflow_submissions_cache')) {
    localStorage.removeItem('jotflow_submissions_cache');
  }
  if (localStorage.getItem('jotflow_sync_fingerprints')) {
    localStorage.removeItem('jotflow_sync_fingerprints');
  }
}

// ─── Clear all JotFlow caches (called after any write action) ─────────────────
function clearAllJotFlowCaches() {
  // Clear localStorage caches used by formDiscovery
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('jotflow_')) localStorage.removeItem(k);
  });
  clearWorkflowStepCache();
  clearWorkflowTaskCache();
  clearApproverConfigCache();
}

// ─── Backend URL for Socket.IO connection ─────────────────────────────────────
// In dev: empty string = same origin (Vite dev server) which proxies /socket.io
// to the backend via the proxy entry in vite.config.ts (ws: true required).
// In prod: same origin (the backend serves both the SPA and the socket).
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubmissions() {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'admin' || orgRole === 'super_admin';
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [activeForms, setActiveForms] = useState<JFFormMeta[]>([]);
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

  // Workflow step cache (populated during loadData; used for optimistic updates)
  const [stepsByForm, setStepsByForm] = useState<Record<string, WorkflowStep[]>>({});

  // ─── Live toast notifications ──────────────────────────────────────────────
  // The submissions list is already server-filtered to rows this user can see,
  // so any new arrival or status change is relevant to them. Diff each load
  // against the previous set and surface a toast. prevSubsRef starts null so the
  // first (initial) load primes the baseline without firing a burst of toasts.
  const { addToast } = useToast();
  const prevSubsRef = useRef<Map<string, string> | null>(null);
  const notifyChanges = useCallback((next: Submission[]) => {
    const prev = prevSubsRef.current;
    const nextMap = new Map(next.map(s => [s.id, String(s.currentApprovalLevel)]));
    if (prev) {
      let shown = 0;
      for (const s of next) {
        if (shown >= 3) break; // toast component caps at 3 — don't flood on a big delta
        if (!prev.has(s.id)) {
          addToast({ type: 'submission', title: 'New submission', message: `${s.formTitle || 'Form'} — ${s.submittedBy.name}` });
          shown++;
        } else if (prev.get(s.id) !== String(s.currentApprovalLevel)) {
          const lvl = s.currentApprovalLevel;
          const statusMsg = lvl === 'completed' ? 'completed' : lvl === 'rejected' ? 'rejected' : `at level ${lvl}`;
          addToast({ type: 'approval_needed', title: 'Status updated', message: `${s.formTitle || 'Form'} is now ${statusMsg}` });
          shown++;
        }
      }
    }
    prevSubsRef.current = nextMap;
  }, [addToast]);

  const loadData = useCallback(async (opts?: { force?: boolean; silent?: boolean }) => {
    const force = opts?.force ?? false;
    const silent = opts?.silent ?? false;
    checkAndClearWorkspaceCaches();
    if (force) clearAllJotFlowCaches();

    // Silent mode: skip the loading spinner (used for background refresh
    // after an instant keyType swap that already painted from cache).
    if (!silent) setLoading(true);
    setError(null);

    // ── First paint from localStorage cache (≤30min old) ─────────────────────
    // Scoped by JotForm key type so default vs gdmo never show each other's cache.
    const cacheKey = `jotflow_submissions_cache_${getJotformKeyType()}`;
    let hasCachedData = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached && !force) {
        const { submissions, forms, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < 30 * 60 * 1000) {
          setAllSubmissions(submissions);
          setActiveForms(forms);
          hasCachedData = true;
          console.log('[useSubmissions] Loaded', submissions.length, 'submissions from localStorage cache');
        }
      }
    } catch (e) {
      console.warn('[useSubmissions] Failed to load cache:', e);
    }

    // ── Fresh load from JotForm + enrichment passes ──────────────────────────
    try {
      const { submissions: mapped, forms, stepsByForm: newStepsByForm, partialDataWarning } =
        await loadAndEnrichSubmissions();

      if (mapped.length > 0) {
        // Batch state updates together — prevents double render / flicker
        setStepsByForm(newStepsByForm);
        setActiveForms(forms);
        setAllSubmissions(mapped);
        setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
        if (partialDataWarning) {
          setError('Some submissions could not be loaded — showing partial data');
        }

        // Cache to localStorage for hot reload
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            submissions: mapped,
            forms: forms,
            timestamp: Date.now(),
          }));
          console.log('[useSubmissions] Cached', mapped.length, 'submissions to localStorage');
        } catch (e) {
          console.warn('[useSubmissions] Failed to cache to localStorage:', e);
        }

        // Delta-push to Supabase (catches anything webhooks missed)
        deltaSyncToSupabase(mapped);
      } else if (forms.length === 0 && !hasCachedData) {
        setError('No JotForm workflows found. Please ensure your JotForm account has enabled forms.');
      } else if (mapped.length === 0 && !hasCachedData) {
        setError('Live data unavailable — showing cached data');
      }
    } catch (err: unknown) {
      if (!hasCachedData) {
        setError(humanizeError(err, 'Failed to load submissions'));
        setAllSubmissions([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // ─── Action cooldown: prevent real-time refresh from overwriting optimistic updates ──
  const actionCooldownUntil = React.useRef<number>(0);
  const startActionCooldown = useCallback((durationMs = 4000) => {
    actionCooldownUntil.current = Date.now() + durationMs;
  }, []);

  // ─── Supabase live-mirror read — fast first paint + webhook-driven refresh ──
  // Webhook keeps jf_submissions live; reading it is ~100ms vs seconds for JotForm.
  // CRITICAL: scope by active form IDs so rows written under a previous
  // JOTFORM_API_KEY don't leak into the dashboard when the current key only
  // has access to a smaller form set.
  const loadFromSupabase = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() < actionCooldownUntil.current) return;
    // Clear any stale error from a previous failed load so a recovered read
    // doesn't keep showing the old error banner.
    setError(null);

    // 1. Ask backend which form IDs are in scope for the active key.
    //    This is the ONLY backend call needed before the DB read — and it's
    //    a metadata call (just the IDs/titles), not a JotForm proxy.
    let scopeForms: JFFormMeta[] = [];
    try {
      const scope = await apiFetch<{ forms?: Array<{ id: string; title: string; count: number; updatedAt: string }> }>(
        '/api/active-form-ids'
      );
      scopeForms = (scope.forms || []).map(f => ({
        id: f.id, title: f.title, status: 'ENABLED', count: f.count, updatedAt: f.updatedAt,
      }));
      setActiveForms(scopeForms);
      // Persist scope so other code that reads jotflow_active_form_ids works.
      try { localStorage.setItem('jotflow_active_form_ids', JSON.stringify(scopeForms.map(f => f.id))); } catch {}
    } catch (e) {
      console.warn('[useSubmissions] active-form-ids fetch failed:', e);
    }

    const activeFormIds = scopeForms.map(f => f.id);
    if (activeFormIds.length === 0) {
      // No forms in scope for the active key — show an explicit empty state, never
      // an indefinite skeleton or a silent blank.
      setAllSubmissions([]);
      setError('No workflows are available for the active key. Try switching the API source in Settings.');
      setLoading(false);
      return;
    }

    // 2. Read submissions for the in-scope forms from the DB.
    try {
      setLoading(prev => allSubmissions.length === 0 ? true : prev);
      const data = await apiFetch<Record<string, unknown>[]>(
        `/api/submissions?form_ids=${activeFormIds.join(',')}&limit=20000&order=desc`
      );
      if (!data || data.length === 0) {
        setAllSubmissions([]);
        notifyChanges([]); // keep the toast baseline in sync (fires nothing)
        setLoading(false);
        return;
      }

      // Map defensively: a single malformed row must never crash the whole
      // dashboard (it would otherwise bubble to the ErrorBoundary). Skip + warn.
      const mapped: Submission[] = [];
      let skipped = 0;
      for (const row of data) {
        try {
          mapped.push(mapSupabaseRow(row as Record<string, unknown>));
        } catch (rowErr) {
          skipped++;
          console.warn('[useSubmissions] skipped malformed row:', (row as Record<string, unknown>)?.jotform_submission_id, rowErr);
        }
      }
      if (skipped > 0) console.warn(`[useSubmissions] skipped ${skipped} malformed row(s) of ${data.length}`);
      setAllSubmissions(mapped);
      notifyChanges(mapped); // fire live toasts for new arrivals / status changes
      setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
    } catch (err) {
      console.warn('[useSubmissions] DB read failed:', err);
      setError(humanizeError(err, 'Failed to load submissions'));
    } finally {
      setLoading(false);
    }
  }, [allSubmissions.length, notifyChanges]);

  // ─── On mount: read from DB ────────────────────────────────────────────────
  // Frontend is DB-only — all JotForm API calls happen server-side (poller +
  // /api/admin/sync-all). loadFromSupabase fetches the active scope's form IDs
  // from /api/active-form-ids, then reads /api/submissions for those IDs.
  // To refresh data from JotForm, use Settings → "Sync All Submissions".
  useEffect(() => {
    loadFromSupabase({ force: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for JotForm API key toggle from Settings.
  // Instant swap UX: paint the new key's localStorage cache immediately
  // (no loading spinner, no "No submissions found" flash), then refresh
  // silently in the background. Falls back to a normal load if no cache
  // exists for the new key (first-time switch).
  useEffect(() => {
    const onKeyTypeChanged = () => {
      // Block the table behind the loading state until the new key's data lands,
      // so no stale approver names / cross-key rows flash.
      setLoading(true);
      setError(null);
      // Clear stale display so the old key's rows never paint under the new key.
      setAllSubmissions([]);
      setActiveForms([]);
      // Hard-clear EVERY keyType-scoped cache namespace — both keys' submission
      // caches, sync fingerprints, the active-form-ids scope, and form/question
      // discovery caches — so the new key can't read another key's data.
      try {
        Object.keys(localStorage).forEach(k => {
          if (
            k === 'jotflow_active_form_ids' ||
            k === 'jotflow_sync_fingerprints' ||
            k.startsWith('jotflow_submissions_cache') ||
            k.startsWith('jotflow_q') ||
            k.startsWith('jotflow_forms')
          ) {
            localStorage.removeItem(k);
          }
        });
      } catch {}
      // In-memory caches keyed by the previous key's data.
      clearWorkflowStepCache();
      clearWorkflowTaskCache();
      clearApproverConfigCache();
      // Re-read from DB with the new key's scope.
      loadFromSupabase({ force: true });
    };
    window.addEventListener('jotform-key-type-changed', onKeyTypeChanged);
    return () => window.removeEventListener('jotform-key-type-changed', onKeyTypeChanged);
  }, [loadFromSupabase]);

  // Auto-register webhooks on mount (admin only, cached for 24h)
  useEffect(() => {
    if (!isAdmin) return;
    const WEBHOOK_CACHE_KEY = 'jotflow_webhooks_registered';
    const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    try {
      const cached = localStorage.getItem(WEBHOOK_CACHE_KEY);
      if (cached && Date.now() - Number(cached) < WEBHOOK_CACHE_TTL) return;
      apiFetch('/api/register-webhooks', { method: 'POST' })
        .then(() => localStorage.setItem(WEBHOOK_CACHE_KEY, String(Date.now())))
        .catch(err => console.warn('[JotFlow] Webhook registration failed:', err));
    } catch {}
  }, [isAdmin]);

  // ─── Socket.IO: receive submissions:updated from backend poller ─────────────
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['polling'],
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

  // Polling fallback — replaces Supabase realtime channel (30s).
  // Runs alongside Socket.IO so a missed event still catches up.
  useEffect(() => {
    const interval = setInterval(loadFromSupabase, 15_000);
    return () => clearInterval(interval);
  }, [loadFromSupabase]);

  // Auto-refresh (1 min fallback) — uses lightweight Supabase query, no spinner
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

  // ─── Optimistic update: immediately patch a submission in state ─────────────
  // Call right after a successful write to JotForm so the UI reflects the
  // new status instantly, without waiting for the next full re-fetch.
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
    try { localStorage.removeItem('jotflow_submissions_cache'); } catch { /* ignore */ }
    // Staggered retries: 3s, 6s, 12s — webhook usually fires within 5-10s.
    const timers = [3000, 6000, 12000].map(ms =>
      setTimeout(() => loadFromSupabase({ force: true }), ms)
    );
    return () => timers.forEach(t => clearTimeout(t));
  }, [loadFromSupabase, startActionCooldown]);

  return {
    allSubmissions, filteredSubmissions, paginatedSubmissions,
    activeForms,
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
