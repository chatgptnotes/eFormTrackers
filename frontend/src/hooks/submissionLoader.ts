/**
 * submissionLoader.ts
 *
 * Pulls submissions from the JotForm API (forms → questions → bulk submissions),
 * runs the three-pass enrichment pipeline (workflow tasks → comments → mapping),
 * and pushes a delta sync to Supabase.
 *
 * Side-effects live here so useSubmissions can stay focused on React state.
 */
import { Submission, ApprovalEntry, ApprovalLevel } from '../types';
import { apiFetch } from '../lib/api';
import { fetchUserForms, fetchFormQuestions, detectFields, JFFormMeta } from '../services/formDiscovery';
import { jotformHeaders } from '../lib/jotformKey';
import { pMapLimit, pMapLimitSettled } from '../lib/pMapLimit';
import { WorkflowStep, fetchWorkflowSteps, fetchWorkflowTasks } from './workflowTaskCache';
import { ApproverConfig, fetchApproverConfigs } from './useApproverConfig';
import { mapGenericSubmission } from './submissionMappers';

export interface LoadFromJotFormResult {
  submissions: Submission[];
  forms: JFFormMeta[];
  stepsByForm: Record<string, WorkflowStep[]>;
  partialDataWarning: boolean;
}

/**
 * Discover all forms, then fetch (questions, submissions, workflow steps) in
 * parallel for each. Returns the raw per-form bundles for the enrichment passes.
 */
async function fetchAllFormData(): Promise<{
  forms: JFFormMeta[];
  formResults: Array<{
    form: JFFormMeta;
    rows: Record<string, unknown>[];
    detectedFields: ReturnType<typeof detectFields>;
    steps: WorkflowStep[];
  }>;
  partialDataWarning: boolean;
}> {
  const forms = await fetchUserForms();
  // Persist this account's form IDs so loadFromSupabase can scope its query
  // and never paint rows belonging to a previous JOTFORM_API_KEY.
  try {
    localStorage.setItem('jotflow_active_form_ids', JSON.stringify(forms.map(f => f.id)));
  } catch { /* ignore */ }

  let partialDataWarning = false;
  // Cap outer concurrency so we don't open hundreds of sockets at once when an
  // account has many forms — each form already fans out 3 inner requests.
  const formResults = await pMapLimit(forms, 5, async (form) => {
      // Fetch questions, submissions, and workflow steps IN PARALLEL (not sequentially)
      const [questions, rows, steps] = await Promise.all([
        fetchFormQuestions(form.id),
        (async () => {
          // Fetch initial submissions (2 pages max = ~2000 submissions for fast initial load)
          const pageLimit = 1000;
          const maxPagesInitial = 2;
          let offset = 0;
          let pageCount = 0;
          const rows: Record<string, unknown>[] = [];
          while (pageCount < maxPagesInitial) {
            const res = await fetch(
              `/api/jotform?path=form/${form.id}/submissions&limit=${pageLimit}&offset=${offset}&orderby=created_at&direction=DESC&addWorkflowStatus=1`,
              { headers: jotformHeaders() }
            );
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
          return rows;
        })(),
        fetchWorkflowSteps(form.id),
      ]);

      const detectedFields = detectFields(questions);
      return { form, rows, detectedFields, steps };
    }
  );

  return { forms, formResults, partialDataWarning };
}

/**
 * Pass 2: for pending submissions missing workflow data, fetch real workflow
 * tasks and override the mapped fields. Mutates `mapped` in place.
 *
 * `skipIds` carries forward submissions known to be completed/rejected from a
 * previous run — they are filtered out before the per-submission round-trips
 * so we don't re-fetch terminal-state workflows. On a force refresh the caller
 * passes an empty set (or clears the persisted store) so everything is fetched.
 */
async function enrichWithWorkflowTasks(mapped: Submission[], skipIds: Set<string>): Promise<void> {
  const needsEnrichment = (s: Submission): boolean => {
    // Already known terminal (completed/rejected) from a prior cycle — skip.
    if (skipIds.has(s.id)) return false;
    if (typeof s.currentApprovalLevel === 'number') {
      // Pending: only fetch if real approver email is missing or workflow instance unknown
      if (!s.pendingApproverEmail || !s.workflowInstanceId) return true;
      return false;
    }
    // Completed/rejected: only fetch when workflow instance ID is missing (grouping)
    return !s.workflowInstanceId;
  };
  const pendingSubs = mapped.filter(needsEnrichment).slice(0, 100);
  if (pendingSubs.length === 0) return;

  // Cap inner concurrency to avoid blasting JotForm with 100 parallel requests.
  const taskResults = await pMapLimitSettled(
    pendingSubs, 8, sub => fetchWorkflowTasks(sub.id),
  );
  for (let i = 0; i < pendingSubs.length; i++) {
    const result = taskResults[i];
    if (result.status !== 'fulfilled') continue;
    const { tasks, workflowInstanceId: wfInstanceId } = result.value;
    const sub = pendingSubs[i];

    // Capture workflowInstanceId from the workflow API
    console.log(`[useSubmissions] Sub ${sub.id}: API returned wfInstanceId="${wfInstanceId}", before enrichment sub.workflowInstanceId="${sub.workflowInstanceId}"`);
    if (wfInstanceId) sub.workflowInstanceId = wfInstanceId;
    console.log(`[useSubmissions] Sub ${sub.id}: after enrichment sub.workflowInstanceId="${sub.workflowInstanceId}"`);
    if (tasks.length === 0) continue;

    // Find the currently ACTIVE task
    const activeTask = tasks.find(t => t.status === 'ACTIVE');
    const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'COMPLETED');

    if (allCompleted) {
      // All workflow tasks are done — mark submission as completed
      sub.currentApprovalLevel = 'completed';
      sub.pendingApproverName = undefined;
      sub.pendingApproverEmail = undefined;
      sub.jotformStatus = 'Completed';

      // Rebuild approval history from workflow tasks
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
      // Override the current level
      sub.currentApprovalLevel = activeTask.level as ApprovalLevel;

      // Override pending approver
      sub.pendingApproverName = activeTask.assigneeName || undefined;
      sub.pendingApproverEmail = activeTask.assigneeEmail || undefined;

      // Detect action type from real workflow element.type
      const taskType = activeTask.type || '';
      if (taskType === 'workflow_assign_task') {
        sub.actionType = 'task';
      } else if (taskType === 'workflow_assign_form') {
        sub.actionType = 'form';
      } else if (taskType === 'workflow_approval') {
        sub.actionType = 'approval';
      } else {
        // Fallback to name-based detection for unknown types
        const stepName = activeTask.name.toLowerCase();
        if (stepName.includes('task')) sub.actionType = 'task';
        else if (stepName.includes('form')) sub.actionType = 'form';
        else sub.actionType = 'approval';
      }

      // Prefer accessLink (direct URL with access token from JotForm)
      if (activeTask.accessLink) {
        sub.approvalUrl = activeTask.accessLink;
      } else if (activeTask.taskId && activeTask.internalFormID) {
        const host = 'https://eforms.mediaoffice.ae';
        const qp = taskType === 'workflow_assign_form' ? 'workflowAssignFormTask'
          : taskType === 'workflow_assign_task' ? 'workflowAssignTask'
          : 'workflowApprovalTask';
        sub.approvalUrl = `${host}/${activeTask.internalFormID}?${qp}=1&taskID=${activeTask.taskId}`;
      }

      // Rebuild approval history from workflow tasks
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

      // Update jotformStatus based on workflow state
      sub.jotformStatus = `${activeTask.name} Pending`;
    }
  }
}

/**
 * Pass 3: pull approval comments from jf_approval_history and attach to entries.
 *
 * `skipIds` are submissions known to be in a terminal state from a prior cycle;
 * their comments were already attached and won't change, so we leave them out
 * of the IDs sent to /api/approval-history to keep the query small.
 */
async function enrichWithApprovalComments(mapped: Submission[], skipIds: Set<string>): Promise<void> {
  const submissionIds = mapped.filter(s => !skipIds.has(s.id)).map(s => s.id);
  if (submissionIds.length === 0) return;
  try {
    const approvalRecords = await apiFetch<Record<string, unknown>[]>(
      `/api/approval-history?submission_ids=${submissionIds.join(',')}`
    );

    if (approvalRecords && approvalRecords.length > 0) {
      for (const sub of mapped) {
        // Find all approval records for this submission
        const subApprovals = approvalRecords.filter(
          (r: Record<string, unknown>) => String(r.submission_id) === sub.id
        );

        // For each approval entry in the history, find matching approval record and add comment
        for (const entry of sub.approvalHistory) {
          const matching = subApprovals.find(
            (r: Record<string, unknown>) => Number(r.level) === entry.level
          );
          if (matching && matching.comment) {
            entry.comments = String(matching.comment);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[JotFlow] Failed to fetch approval history:', err);
  }
}

// ─── Delta-sync fingerprint — covers only fields that drive the dashboard ────
function fingerprintSyncRecord(r: {
  id: string;
  currentLevel: number | 'completed' | 'rejected';
  status: string;
  jotformStatus: string;
  pendingApproverName?: string;
  pendingApproverEmail?: string;
  approvalUrl?: string;
  workflowInstanceId?: string;
  approvalHistory: Array<{ level: number; status: string; approverEmail?: string; date?: string }>;
}): string {
  const key = [
    r.id,
    r.currentLevel,
    r.status,
    r.jotformStatus,
    r.pendingApproverName || '',
    r.pendingApproverEmail || '',
    r.approvalUrl || '',
    r.workflowInstanceId || '',
    r.approvalHistory.map(h => `${h.level}:${h.status}:${h.approverEmail || ''}:${h.date || ''}`).join('|'),
  ].join('::');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * Fire-and-forget delta sync to Supabase. Only POSTs records whose
 * fingerprint changed since the last sync.
 */
export function deltaSyncToSupabase(mapped: Submission[]): void {
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
      approvalUrl: s.approvalUrl,
      workflowInstanceId: s.workflowInstanceId,
    }));

    const FP_KEY = 'jotflow_sync_fingerprints';
    let prevFp: Record<string, string> = {};
    try { prevFp = JSON.parse(localStorage.getItem(FP_KEY) || '{}'); } catch {}

    const changed: typeof syncRecords = [];
    const nextFp: Record<string, string> = {};
    for (const r of syncRecords) {
      const fp = fingerprintSyncRecord(r);
      nextFp[r.id] = fp;
      if (prevFp[r.id] !== fp) changed.push(r);
    }

    if (changed.length > 0) {
      // Fire-and-forget — don't block the UI
      fetch('/api/sync-to-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: changed }),
      })
        .then(() => { try { localStorage.setItem(FP_KEY, JSON.stringify(nextFp)); } catch {} })
        .catch(err => console.warn('[JotFlow] Sync to Supabase failed:', err));
      console.log(`[useSubmissions] Delta sync: ${changed.length}/${syncRecords.length} changed`);
    } else {
      // Persist fingerprints anyway so first-load after cache clear establishes baseline
      try { localStorage.setItem(FP_KEY, JSON.stringify(nextFp)); } catch {}
    }
  } catch {} // ignore sync errors — dashboard still works from JotForm API
}

// ─── Skip-set persistence — carries completed/rejected IDs across cycles ────
// On a force refresh useSubmissions calls clearAllJotFlowCaches() which wipes
// every `jotflow_*` localStorage key, including this one. That's how force
// bypasses the skip: the next load starts with an empty set and re-fetches
// everything. No explicit force flag needs to be threaded through.
const ENRICH_SKIP_KEY = 'jotflow_enrich_skip_set';

function loadSkipIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ENRICH_SKIP_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(String));
  } catch {
    return new Set();
  }
}

function persistSkipIds(mapped: Submission[]): void {
  try {
    const ids = mapped
      .filter(s => s.currentApprovalLevel === 'completed' || s.currentApprovalLevel === 'rejected')
      .map(s => s.id);
    localStorage.setItem(ENRICH_SKIP_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

/**
 * End-to-end pipeline: forms → submissions → 3-pass enrichment.
 * Returns mapped Submissions plus per-form workflow steps (used for optimistic
 * updates) and a flag indicating whether some pages failed mid-way.
 */
export async function loadAndEnrichSubmissions(): Promise<LoadFromJotFormResult> {
  const { forms, formResults, partialDataWarning } = await fetchAllFormData();

  const mapped: Submission[] = [];
  const stepsByForm: Record<string, WorkflowStep[]> = {};

  // Manual approver configs only — dynamic detection is deferred (background)
  let mergedConfigs: ApproverConfig[] = [];
  try {
    const manualConfigs = await fetchApproverConfigs();
    mergedConfigs = [...manualConfigs];
    console.log('[useSubmissions] Loaded', mergedConfigs.length, 'manual approver configs');
  } catch (e) {
    console.warn('[useSubmissions] Failed to fetch approver configs:', e);
  }

  // Pass 1: map all submissions using detected field structure
  for (const { form, rows, detectedFields, steps } of formResults) {
    stepsByForm[form.id] = steps;
    for (const raw of rows) {
      mapped.push(mapGenericSubmission(raw, form.id, form.title, detectedFields, steps, [], mergedConfigs));
    }
  }

  // Load the set of IDs that were completed/rejected in the previous cycle.
  // Empty on first load and after any force-refresh (cache was cleared).
  const skipIds = loadSkipIds();
  if (skipIds.size > 0) {
    console.log('[useSubmissions] Skipping workflow/comment fetch for', skipIds.size, 'known terminal submissions');
  }

  // Pass 2: enrich pending submissions with real workflow task data
  await enrichWithWorkflowTasks(mapped, skipIds);

  // Pass 3: attach approval comments from jf_approval_history
  await enrichWithApprovalComments(mapped, skipIds);

  // Refresh the skip set so next cycle can skip whatever is now terminal,
  // including submissions that just transitioned from pending → completed.
  persistSkipIds(mapped);

  return { submissions: mapped, forms, stepsByForm, partialDataWarning };
}
