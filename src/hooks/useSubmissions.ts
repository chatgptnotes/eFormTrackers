import { useState, useEffect, useCallback, useMemo } from 'react';
import { Submission, ApprovalEntry, ApprovalLevel, WorkflowActionType } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/mockData';
import { supabase } from '../lib/supabase';
import { fetchUserForms, fetchFormQuestions, detectFields, JFFormMeta } from '../services/formDiscovery';
import {
  WorkflowStep, fetchWorkflowSteps, fetchWorkflowTasks,
  fetchApproverConfigs, ApproverConfig,
  checkAndClearWorkspaceCaches, clearAllJotFlowCaches,
} from '../services/workflowCache';
import { mapGenericSubmission, extractText, parseApproverFromActionText } from '../services/submissionMapper';
import { useSubmissionFilters } from './useSubmissionFilters';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubmissions() {
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [activeForms, setActiveForms] = useState<JFFormMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshConfig, setRefreshConfig] = useState({
    autoRefresh: true,
    intervalMinutes: 1,
    lastUpdated: null as string | null,
  });

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    // Always check workspace version on load — clears stale caches if team changed
    checkAndClearWorkspaceCaches();
    // If force-refreshing after a write action, bust all caches first
    if (force) clearAllJotFlowCaches();

    setLoading(true);
    setError(null);

    // ── Fetch all forms + submissions fresh from JotForm ─────────────────────
    try {
      const forms = await fetchUserForms();

      let partialDataWarning = false;
      const formResults = await Promise.all(
        forms.map(async (form) => {
          const questions = await fetchFormQuestions(form.id);

          // Fetch submissions with pagination (JotForm caps at 1000 per request)
          // Server-side filter: only fetch submissions from last 90 days to reduce data transfer
          const pageLimit = 1000;
          const maxPages = 10;
          let offset = 0;
          let pageCount = 0;
          const rows: Record<string, unknown>[] = [];

          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - 90);
          const filterObj = { "created_at:gt": cutoffDate.toISOString().slice(0, 19) };
          const filterParam = `&filter=${encodeURIComponent(JSON.stringify(filterObj))}`;

          while (pageCount < maxPages) {
            let res = await fetch(
              `/api/jotform?path=form/${form.id}/submissions&limit=${pageLimit}&offset=${offset}&orderby=created_at&direction=DESC${filterParam}`
            );
            // Fallback: if filter causes an error, retry without it
            if (!res.ok && pageCount === 0 && offset === 0) {
              res = await fetch(
                `/api/jotform?path=form/${form.id}/submissions&limit=${pageLimit}&offset=${offset}&orderby=created_at&direction=DESC`
              );
            }
            if (!res.ok) {
              console.warn(`[JotFlow] Failed to fetch submissions for form ${form.id} (offset=${offset}, status=${res.status})`);
              if (rows.length > 0) partialDataWarning = true;
              break;
            }
            const data = await res.json();
            const page: Record<string, unknown>[] = data?.content || [];
            rows.push(...page);
            if (page.length < pageLimit) break;
            offset += pageLimit;
            pageCount++;
          }
          const detectedFields = detectFields(questions);
          const steps = await fetchWorkflowSteps(form.id);
          return { form, rows, detectedFields, steps };
        })
      );

      const totalRows = formResults.reduce((sum, r) => sum + r.rows.length, 0);

      if (totalRows > 0) {
        const mapped: Submission[] = [];
        const newStepsByForm: Record<string, WorkflowStep[]> = {};

        // ── Dynamic approver detection: scan ALL submissions to build a live approver map ──
        const dynamicApprovers: ApproverConfig[] = [];
        for (const { form, rows, detectedFields } of formResults) {
          for (const lf of detectedFields.levelFields) {
            const approverCounts: Record<string, { name: string; email: string; count: number; latestDate: string }> = {};
            for (const raw of rows) {
              const answers = (raw.answers as Record<string, { answer: unknown }>) || {};
              const statusVal = lf.statusFieldId ? extractText(answers[lf.statusFieldId]?.answer).toLowerCase() : '';
              if (!statusVal.includes('approved') && !statusVal.includes('rejected')) continue;
              const approverVal = lf.approverFieldId ? extractText(answers[lf.approverFieldId]?.answer) : '';
              const parsed = parseApproverFromActionText(approverVal);
              if (!parsed || !parsed.name) continue;
              const key = parsed.email || parsed.name;
              const date = String(raw.updated_at || raw.created_at || '');
              if (!approverCounts[key]) {
                approverCounts[key] = { name: parsed.name, email: parsed.email, count: 0, latestDate: date };
              }
              approverCounts[key].count++;
              if (date > approverCounts[key].latestDate) {
                approverCounts[key].latestDate = date;
                approverCounts[key].name = parsed.name;
                approverCounts[key].email = parsed.email;
              }
            }
            const best = Object.values(approverCounts).sort((a, b) =>
              b.latestDate.localeCompare(a.latestDate) || b.count - a.count
            )[0];
            if (best) {
              dynamicApprovers.push({
                formId: form.id,
                level: lf.level,
                approverName: best.name,
                approverEmail: best.email,
              });
            }
          }
        }

        // Also merge any manually configured approvers (admin overrides)
        const manualConfigs = await fetchApproverConfigs();
        const mergedConfigs = [...dynamicApprovers];
        for (const mc of manualConfigs) {
          const idx = mergedConfigs.findIndex(d => d.formId === mc.formId && d.level === mc.level);
          if (idx >= 0) mergedConfigs[idx] = mc;
          else mergedConfigs.push(mc);
        }

        // First pass: map all submissions with dynamic approver data
        for (const { form, rows, detectedFields, steps } of formResults) {
          newStepsByForm[form.id] = steps;
          for (const raw of rows) {
            mapped.push(mapGenericSubmission(raw, form.id, form.title, detectedFields, steps, [], mergedConfigs));
          }
        }

        // Second pass: batch-fetch REAL workflow tasks for pending submissions (up to 50)
        const pendingSubs = mapped.filter(s => typeof s.currentApprovalLevel === 'number').slice(0, 50);
        if (pendingSubs.length > 0) {
          const taskResults = await Promise.allSettled(
            pendingSubs.map(sub => fetchWorkflowTasks(sub.id))
          );
          for (let i = 0; i < pendingSubs.length; i++) {
            const result = taskResults[i];
            if (result.status !== 'fulfilled' || result.value.length === 0) continue;
            const tasks = result.value;
            const sub = pendingSubs[i];

            // Find the currently ACTIVE task
            const activeTask = tasks.find(t => t.status === 'ACTIVE');
            const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'COMPLETED');

            if (allCompleted) {
              sub.currentApprovalLevel = 'completed';
              sub.pendingApproverName = undefined;
              sub.pendingApproverEmail = undefined;
              sub.jotformStatus = 'Completed';

              const newHistory: ApprovalEntry[] = [];
              for (const task of tasks) {
                newHistory.push({
                  level: task.level as ApprovalLevel,
                  approverName: task.assigneeName || task.name,
                  approverEmail: task.assigneeEmail || '',
                  status: 'approved',
                  date: task.updatedAt || undefined,
                });
              }
              if (newHistory.length > 0) {
                sub.approvalHistory = newHistory;
              }
            } else if (activeTask) {
              sub.currentApprovalLevel = activeTask.level as ApprovalLevel;
              sub.pendingApproverName = activeTask.assigneeName || undefined;
              sub.pendingApproverEmail = activeTask.assigneeEmail || undefined;

              const taskType = activeTask.type || '';
              if (taskType === 'workflow_assign_task') {
                sub.actionType = 'task';
              } else if (taskType === 'workflow_assign_form') {
                sub.actionType = 'form';
              } else if (taskType === 'workflow_approval') {
                sub.actionType = 'approval';
              } else {
                const stepName = activeTask.name.toLowerCase();
                if (stepName.includes('task')) sub.actionType = 'task';
                else if (stepName.includes('form')) sub.actionType = 'form';
                else sub.actionType = 'approval';
              }

              const newHistory: ApprovalEntry[] = [];
              for (const task of tasks) {
                const isCompleted = task.status === 'COMPLETED';
                newHistory.push({
                  level: task.level as ApprovalLevel,
                  approverName: task.assigneeName || task.name,
                  approverEmail: task.assigneeEmail || '',
                  status: isCompleted ? 'approved' : 'pending',
                  date: task.updatedAt || undefined,
                });
              }
              if (newHistory.length > 0) {
                sub.approvalHistory = newHistory;
              }

              sub.jotformStatus = `${activeTask.name} Pending`;
            }
          }
        }
        // Batch state updates together — prevents double render / flicker
        setStepsByForm(newStepsByForm);
        setActiveForms(forms);
        setAllSubmissions(mapped);
        setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
        if (partialDataWarning) {
          setError('Some submissions could not be loaded — showing partial data');
        }

        // ── Sync enriched data to Supabase (fire-and-forget) ──────────────
        try {
          const syncRecords = mapped.map(s => ({
            id: s.id,
            formId: s.formId,
            formTitle: s.formTitle,
            title: s.title,
            description: s.description,
            submitterName: s.submittedBy.name,
            submitterEmail: s.submittedBy.email,
            department: s.submittedBy.department,
            submissionDate: s.submissionDate,
            currentLevel: s.currentApprovalLevel,
            status: s.jotformStatus,
            priority: s.priority,
            jotformStatus: s.jotformStatus,
            pendingApproverName: s.pendingApproverName,
            pendingApproverEmail: s.pendingApproverEmail,
            approvalHistory: s.approvalHistory,
            answers: s.answers,
            actionType: s.actionType,
          }));
          fetch('/api/sync-to-supabase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: syncRecords }),
          }).catch(() => {});
        } catch {}
      } else if (forms.length === 0) {
        setError('No JotForm workflows found. Please ensure your JotForm account has enabled forms.');
      } else if (totalRows === 0) {
        setError('Live data unavailable — showing cached data');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setAllSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Supabase real-time subscription — re-fetch on ANY change to jf_submissions or jf_approval_history
  useEffect(() => {
    const channel = supabase
      .channel('jf_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jf_submissions',
      }, () => {
        loadData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jf_approval_history',
      }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Auto-refresh (1 min fallback if webhooks fail)
  useEffect(() => {
    if (!refreshConfig.autoRefresh) return;
    const interval = setInterval(loadData, refreshConfig.intervalMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshConfig.autoRefresh, refreshConfig.intervalMinutes, loadData]);

  // ─── Filtering / sorting / pagination (delegated) ──────────────────────────
  const {
    filters, setFilters,
    sort, setSort,
    pagination, setPagination,
    filteredSubmissions, paginatedSubmissions,
  } = useSubmissionFilters(allSubmissions);

  const stats = useMemo(() => getDashboardStats(allSubmissions), [allSubmissions]);
  const approvalStats = useMemo(() => getApprovalLevelStats(allSubmissions), [allSubmissions]);
  const departmentStats = useMemo(() => getDepartmentStats(allSubmissions), [allSubmissions]);
  const trendData = useMemo(() => getTrendData(allSubmissions), [allSubmissions]);
  const bottleneckData = useMemo(() => getBottleneckData(allSubmissions), [allSubmissions]);
  const heatmapData = useMemo(() => getHeatmapData(allSubmissions), [allSubmissions]);

  // ─── Workflow step cache (for optimistic updates) ─────────────────────────
  const [stepsByForm, setStepsByForm] = useState<Record<string, WorkflowStep[]>>({});

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

  return {
    allSubmissions, filteredSubmissions, paginatedSubmissions,
    activeForms,
    loading, error,
    stats, approvalStats, departmentStats, trendData, bottleneckData, heatmapData,
    filters, setFilters,
    sort, setSort,
    pagination, setPagination,
    refreshConfig, setRefreshConfig,
    refresh: loadData,
    optimisticUpdate,
  };
}
