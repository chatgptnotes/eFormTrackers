import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Submission, ApprovalEntry, ApprovalLevel, FilterConfig, SortConfig, PaginationConfig, RefreshConfig, WorkflowActionType } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/mockData';
import { supabase } from '../lib/supabase';
import { fetchUserForms, fetchFormQuestions, detectFields, JFFormMeta, DetectedFields } from '../services/formDiscovery';

// ─── Workflow step type cache (per formId) ────────────────────────────────────
interface WorkflowStep { level: number; type: WorkflowActionType; assigneeEmail?: string; }
const workflowCache: Record<string, { steps: WorkflowStep[]; at: number }> = {};
const WORKFLOW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — re-fetches on each page session

async function fetchWorkflowSteps(formId: string): Promise<WorkflowStep[]> {
  const cached = workflowCache[formId];
  if (cached && Date.now() - cached.at < WORKFLOW_CACHE_TTL) return cached.steps;
  try {
    const res = await fetch(`/api/form-workflow?formId=${formId}`);
    if (!res.ok) return [];
    const data = await res.json();
    const steps: WorkflowStep[] = (data.steps || []).map((s: WorkflowStep & { assigneeEmail?: string }) => ({
      level: s.level,
      type: s.type,
      assigneeEmail: s.assigneeEmail || undefined,
    }));
    workflowCache[formId] = { steps, at: Date.now() };
    return steps;
  } catch {
    return [];
  }
}

// ─── Workflow task cache (per submissionId) — actual approver from workflow API ─
interface WorkflowTaskInfo {
  name: string;
  type: string;
  level: number;
  assigneeName: string;
  assigneeEmail: string;
  status: string;
  updatedAt: string;
  taskId: string;
  internalFormID: string;
  accessLink: string;
}
interface WorkflowTaskResult {
  tasks: WorkflowTaskInfo[];
  workflowInstanceId?: string;
}
const workflowTaskCache: Record<string, { result: WorkflowTaskResult; at: number }> = {};
const WORKFLOW_TASK_CACHE_TTL = 5 * 60 * 1000;

async function fetchWorkflowTasks(submissionId: string): Promise<WorkflowTaskResult> {
  const cached = workflowTaskCache[submissionId];
  if (cached && Date.now() - cached.at < WORKFLOW_TASK_CACHE_TTL) return cached.result;
  try {
    const res = await fetch(`/api/workflow-tasks?submissionId=${submissionId}`);
    if (!res.ok) return { tasks: [] };
    const data = await res.json();
    const tasks: WorkflowTaskInfo[] = (data.tasks || []).map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      type: String(t.type || ''),
      level: Number(t.level || 0),
      assigneeName: String(t.assigneeName || ''),
      assigneeEmail: String(t.assigneeEmail || ''),
      status: String(t.status || 'PENDING').toUpperCase(),
      updatedAt: String(t.updatedAt || ''),
      taskId: String(t.taskId || ''),
      internalFormID: String(t.internalFormID || ''),
      accessLink: String(t.accessLink || ''),
    }));
    const result: WorkflowTaskResult = {
      tasks,
      workflowInstanceId: String(data.workflowInstanceId || '') || undefined,
    };
    workflowTaskCache[submissionId] = { result, at: Date.now() };
    return result;
  } catch {
    return { tasks: [] };
  }
}

/** Get the workflow task approver for a given submission + level */
function getWorkflowTaskApprover(tasks: WorkflowTaskInfo[], level: number): { name: string; email: string } | null {
  const task = tasks.find(t => t.level === level);
  if (task && (task.assigneeName || task.assigneeEmail)) {
    return { name: task.assigneeName, email: task.assigneeEmail };
  }
  return null;
}

// ─── Approver config cache (from Supabase jf_approver_config table) ────────
interface ApproverConfig { formId: string; level: number; approverName: string; approverEmail: string; }
let approverConfigCache: { configs: ApproverConfig[]; at: number } | null = null;
const APPROVER_CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

async function fetchApproverConfigs(): Promise<ApproverConfig[]> {
  if (approverConfigCache && Date.now() - approverConfigCache.at < APPROVER_CONFIG_CACHE_TTL) {
    return approverConfigCache.configs;
  }
  try {
    const res = await fetch('/api/approver-config');
    if (!res.ok) return [];
    const data = await res.json();
    const configs: ApproverConfig[] = (data.configs || []).map((c: Record<string, unknown>) => ({
      formId: String(c.form_id || ''),
      level: Number(c.level || 0),
      approverName: String(c.approver_name || ''),
      approverEmail: String(c.approver_email || ''),
    }));
    approverConfigCache = { configs, at: Date.now() };
    return configs;
  } catch {
    return [];
  }
}

function getConfiguredApprover(configs: ApproverConfig[], formId: string, level: number): { name: string; email: string } | null {
  const config = configs.find(c => c.formId === formId && c.level === level);
  if (config && (config.approverName || config.approverEmail)) {
    return { name: config.approverName, email: config.approverEmail };
  }
  return null;
}

// ─── Shared utilities ────────────────────────────────────────────────────────
/** Parse JotForm "YYYY-MM-DD HH:MM:SS" (UTC) or ISO 8601 string into a Date */
function parseUTC(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}

/** Aging thresholds (days) for overallStatus classification */
const AGING_WARN_DAYS = 3;
const AGING_CRITICAL_DAYS = 7;
function agingStatus(days: number): 'on-track' | 'delayed' | 'critical' {
  return days > AGING_CRITICAL_DAYS ? 'critical' : days > AGING_WARN_DAYS ? 'delayed' : 'on-track';
}

// ─── Workspace version — bump when switching teams to force full cache clear ──
const WORKSPACE_VERSION = 'gdmo-bettroi-v3'; // bumped: force cache clear after new Vercel deploy
const WS_VERSION_KEY = 'jotflow_workspace_version';

function checkAndClearWorkspaceCaches() {
  const stored = localStorage.getItem(WS_VERSION_KEY);
  if (stored !== WORKSPACE_VERSION) {
    // Workspace changed — nuke ALL jotflow_* caches so no stale data shows
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('jotflow_')) localStorage.removeItem(k);
    });
    localStorage.setItem(WS_VERSION_KEY, WORKSPACE_VERSION);
    Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
  }
}

// ─── Clear all JotFlow caches (called after any write action) ─────────────────
function clearAllJotFlowCaches() {
  // Clear localStorage caches used by formDiscovery
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('jotflow_')) localStorage.removeItem(k);
  });
  // Clear in-process workflow step cache
  Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
  // Clear workflow task cache (per-submission real workflow data)
  Object.keys(workflowTaskCache).forEach(k => delete workflowTaskCache[k]);
  // Clear approver config cache
  approverConfigCache = null;
}

function getActionType(steps: WorkflowStep[], currentLevel: number | string): WorkflowActionType {
  if (typeof currentLevel !== 'number') return 'approval';
  const step = steps.find(s => s.level === currentLevel);
  return step?.type ?? 'approval';
}

// Pure submission forms — no approval status fields; always show "Open in JotForm"
const FORM_ONLY_IDS = new Set<string>();

// ─── Field extractor ─────────────────────────────────────────────────────────
function extractText(answer: unknown): string {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, string>;
    if (obj.first !== undefined || obj.last !== undefined)
      return [obj.first, obj.last].filter(Boolean).join(' ');
    if (obj.year && obj.month && obj.day)
      return `${obj.year}-${String(obj.month).padStart(2, '0')}-${String(obj.day).padStart(2, '0')}`;
    return Object.values(obj).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

// ─── Parse approver name/email from JotFlow action text ─────────────────────
// Action text format: "Action: Approved | By: Murali BK (bk@bettroi.com) | Via: JotFlow | Date: ..."
function parseApproverFromActionText(text: string): { name: string; email: string } | null {
  if (!text) return null;
  // Pattern: "By: Name (email@domain.com)"
  const match = text.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  // Pattern: "By: Name |" (no email in parens)
  const nameOnly = text.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
  if (nameOnly) return { name: nameOnly[1].trim(), email: '' };
  return null;
}

// ─── Map any JotForm submission using heuristically-detected fields ───────────
function mapGenericSubmission(
  raw: Record<string, unknown>,
  formId: string,
  formTitle: string,
  fields: DetectedFields,
  workflowSteps: WorkflowStep[] = [],
  workflowTasks: WorkflowTaskInfo[] = [],
  approverConfigs: ApproverConfig[] = [],
): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string | null) => id ? extractText(answers[id]?.answer) : '';

  // Build dynamic form table data from all answers
  const skipTypes = new Set(['control_button', 'control_head', 'control_pagebreak', 'control_divider', 'control_text', 'control_image', 'control_collapse', 'control_captcha']);
  const formTableData: Array<{ label: string; value: string }> = [];
  for (const [, field] of Object.entries(answers)) {
    const f = field as Record<string, unknown>;
    const fieldType = String(f.type || '');
    if (skipTypes.has(fieldType)) continue;
    const label = String(f.text || f.name || '');
    const value = extractText(f.answer);
    if (label) {
      formTableData.push({ label, value });
    }
  }

  const requesterName = get(fields.nameFieldId);
  const email = get(fields.emailFieldId);
  const department = get(fields.deptFieldId) || 'General';
  const description = get(fields.descFieldId) || formTitle;
  const amount = get(fields.amountFieldId);
  const priorityRaw = (get(fields.priorityFieldId) || 'medium').toLowerCase();
  const priority = (['urgent', 'high', 'medium', 'low'].find(p => priorityRaw.includes(p)) || 'medium') as 'low' | 'medium' | 'high' | 'urgent';

  const history: ApprovalEntry[] = [];
  let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1 as ApprovalLevel;

  // Evaluator email from submission answers — single or per-level
  const evaluatorEmail = fields.evaluatorEmailFieldId ? get(fields.evaluatorEmailFieldId) : '';
  const getEvaluatorEmail = (level: number): string => {
    const perLevelFieldId = fields.evaluatorEmailsByLevel?.[level];
    if (perLevelFieldId) return get(perLevelFieldId);
    return evaluatorEmail; // fallback to single evaluator email
  };
  // Assignee email from workflow step configuration (set in form-workflow API)
  const getStepAssignee = (level: number): string => {
    const step = workflowSteps.find(s => s.level === level);
    return step?.assigneeEmail || '';
  };

  if (fields.levelFields.length > 0) {
    for (const lf of fields.levelFields) {
      const statusVal = get(lf.statusFieldId).toLowerCase();
      const rawApproverField = get(lf.approverFieldId);
      const parsed = parseApproverFromActionText(rawApproverField);
      const wfApprover = getWorkflowTaskApprover(workflowTasks, lf.level);
      const date = get(lf.dateFieldId) || undefined;

      if (statusVal === 'approved') {
        // APPROVED: use actual data — parsed action text, then raw field, then config as fallback
        const configApprover = getConfiguredApprover(approverConfigs, formId, lf.level);
        const approverName = parsed?.name || configApprover?.name || wfApprover?.name || getEvaluatorEmail(lf.level) || getStepAssignee(lf.level)
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = parsed?.email || configApprover?.email || wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'approved', date });
        const isLast = lf.level === fields.levelFields[fields.levelFields.length - 1].level;
        currentLevel = isLast ? 'completed' : (lf.level + 1) as ApprovalLevel;
      } else if (statusVal === 'rejected' || statusVal === 'denied') {
        const configApprover = getConfiguredApprover(approverConfigs, formId, lf.level);
        const approverName = parsed?.name || configApprover?.name || wfApprover?.name
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = parsed?.email || configApprover?.email || wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'rejected', date });
        currentLevel = 'rejected';
        break;
      } else {
        // PENDING: only use THIS submission's own data — don't inject guessed names from other submissions
        // Use evaluator email or workflow API if available, otherwise show "Level X Approver" (renders as "Pending Review")
        const approverName = wfApprover?.name || getEvaluatorEmail(lf.level) || getStepAssignee(lf.level)
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'pending' });
        currentLevel = lf.level as ApprovalLevel;
        break;
      }
    }
  } else {
    // Single-level: read overall status field
    const overall = get(fields.overallStatusFieldId).toLowerCase();
    if (overall.includes('approved') || overall.includes('complet')) currentLevel = 'completed';
    else if (overall.includes('reject') || overall.includes('denied')) currentLevel = 'rejected';
    else currentLevel = 1 as ApprovalLevel;

    const wfApprover = getWorkflowTaskApprover(workflowTasks, 1);
    const histStatus = typeof currentLevel === 'number' ? 'pending' : currentLevel === 'completed' ? 'approved' : 'rejected';
    // For acted levels, use config. For pending, only use direct data.
    if (histStatus !== 'pending') {
      const configApprover = getConfiguredApprover(approverConfigs, formId, 1);
      history.push({ level: 1 as ApprovalLevel, approverName: configApprover?.name || wfApprover?.name || evaluatorEmail || getStepAssignee(1) || 'Approver', approverEmail: configApprover?.email || wfApprover?.email || '', status: histStatus });
    } else {
      history.push({ level: 1 as ApprovalLevel, approverName: wfApprover?.name || evaluatorEmail || getStepAssignee(1) || 'Approver', approverEmail: wfApprover?.email || '', status: 'pending' });
    }
  }

  // Overall status field can override level computation
  const overallFinal = get(fields.overallStatusFieldId).toLowerCase();
  if (overallFinal.includes('complet')) currentLevel = 'completed';
  else if (overallFinal.includes('reject')) currentLevel = 'rejected';

  // needsSync is no longer needed — webhooks + real-time subscriptions handle updates automatically
  const needsSync = false;

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

  const lastApproval = [...history].reverse().find(h => h.status === 'approved' && h.date);
  const levelStartDate = lastApproval?.date ? parseUTC(lastApproval.date) : submissionDate;
  const daysAtCurrentLevel = typeof currentLevel === 'number'
    ? Math.floor((Date.now() - levelStartDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  const actionType = getActionType(workflowSteps, currentLevel);
  const inboxUrl = `https://eforms.mediaoffice.ae/inbox/${formId}/${id}`;
  const prefix = formTitle.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'WF';

  const rawGenericStatus = get(fields.overallStatusFieldId);
  const genericJotformStatus = rawGenericStatus ||
    (currentLevel === 'completed' ? 'Completed' :
     currentLevel === 'rejected' ? 'Rejected' :
     history.some(h => h.status === 'approved') ? 'In Progress' : 'Pending');

  // Prepend metadata columns to match JotForm Tables view
  formTableData.unshift(
    { label: 'Submission Date', value: createdAt ? submissionDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '' },
    { label: 'Flow Status', value: genericJotformStatus }
  );

  return {
    id,
    formId,
    formTitle,
    referenceNumber: `${prefix}-${id.slice(-6)}`,
    title: description,
    description: `${description}${amount ? ' — AED ' + amount : ''}`,
    editLink: editLink || undefined,
    actionType,
    taskUrl: inboxUrl,
    formUrl: inboxUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus: genericJotformStatus,
    priority,
    answers: { description, amount, department, email, requester: requesterName },
    formTableData,
    levelFieldMap: fields.levelFields.length > 0
      ? fields.levelFields.map(lf => ({
          level: lf.level,
          statusFieldId: lf.statusFieldId,
          approverFieldId: lf.approverFieldId,
          overallStatusFieldId: fields.overallStatusFieldId,
        }))
      : fields.overallStatusFieldId
        ? [{ level: 1, statusFieldId: fields.overallStatusFieldId, approverFieldId: null, overallStatusFieldId: fields.overallStatusFieldId }]
        : undefined,
    workflowInstanceId: (() => {
      const wfId = String(raw.workflowInstanceID || raw.workflow_instance_id || '') || undefined;
      if (raw.id) console.log(`[mapGenericSubmission] Sub ${raw.id}: Pass 1 workflowInstanceId from bulk API = "${wfId}"`);
      return wfId;
    })(),
    needsSync,
    pendingApproverName: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverName || undefined;
    })(),
    pendingApproverEmail: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverEmail || undefined;
    })(),
  };
}

// ─── Map a Supabase row back to a Submission ──────────────────────────────────
function mapSupabaseRow(row: Record<string, unknown>): Submission {
  const raw = (row.raw_data as Record<string, unknown>) || {};

  // Fallback: use the pre-mapped fields from Supabase
  // level_history (top-level, written by webhook) takes priority over raw_data._mapped.levels (written by sync-to-supabase)
  const mapped = (raw._mapped as Record<string, unknown>) || {};
  const levelHistory = (row.level_history as Array<Record<string, unknown>>) || (mapped.levels as Array<Record<string, unknown>>) || [];
  const history: ApprovalEntry[] = levelHistory.map(l => {
    // Normalize both shapes: webhook writes { id, approver }, sync writes { level, approverName }
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

  // Enrich history with pending approver from Supabase if available
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

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSubmissions() {
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

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    // Always check workspace version on load — clears stale caches if team changed
    checkAndClearWorkspaceCaches();
    // If force-refreshing after a write action, bust all caches first
    if (force) clearAllJotFlowCaches();

    setLoading(true);
    setError(null);

    // ── Skip stale Supabase Phase 1 — go straight to fresh JotForm data ──────
    // Showing stale cached data first causes a visible flicker when workspace
    // changed or Supabase is out-of-date. We wait for live data instead.
    const hasCachedData = false;

    // ── Fetch all forms + submissions fresh from JotForm ─────────────────────
    try {
      // Discover all enabled JotForm workflows for this account (no fire-and-forget sync)
      const forms = await fetchUserForms();
      // Don't setActiveForms yet — wait until submissions are ready to avoid mid-load flicker

      // Fetch submissions + questions for all forms in parallel
      let partialDataWarning = false;
      const formResults = await Promise.all(
        forms.map(async (form) => {
          const questions = await fetchFormQuestions(form.id);

          // Fetch ALL submissions with pagination (JotForm caps at 1000 per request)
          const pageLimit = 1000;
          const maxPages = 10; // Safety cap to prevent runaway loops
          let offset = 0;
          let pageCount = 0;
          const rows: Record<string, unknown>[] = [];
          while (pageCount < maxPages) {
            const res = await fetch(
              `/api/jotform?path=form/${form.id}/submissions&limit=${pageLimit}&offset=${offset}&orderby=created_at&direction=DESC&addWorkflowStatus=1`
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
        // For each form+level, find the most recent person who approved, and use their
        // name for pending submissions at that level. Fully dynamic — no config table needed.
        const dynamicApprovers: ApproverConfig[] = [];
        for (const { form, rows, detectedFields } of formResults) {
          // For each level field, scan all submissions to find who approved
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
            // Pick the most recent approver (not most common — reflects latest assignment)
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
          // Manual config overrides dynamic detection
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

        // Second pass: batch-fetch REAL workflow tasks for all submissions
        // Prioritize pending subs (need real approver data), then completed/rejected (need workflowInstanceId for grouping)
        const pendingSubs = [
          ...mapped.filter(s => typeof s.currentApprovalLevel === 'number'),
          ...mapped.filter(s => typeof s.currentApprovalLevel !== 'number' && !s.workflowInstanceId),
        ];
        if (pendingSubs.length > 0) {
          const taskResults = await Promise.allSettled(
            pendingSubs.map(sub => fetchWorkflowTasks(sub.id))
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
        // Batch state updates together — prevents double render / flicker
        setStepsByForm(newStepsByForm);
        setActiveForms(forms);
        setAllSubmissions(mapped);
        setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
        if (partialDataWarning) {
          setError('Some submissions could not be loaded — showing partial data');
        }

        // ── Sync enriched data to Supabase (fire-and-forget) ──────────────
        // Push ALL submissions with workflow-enriched data so Supabase
        // always mirrors the latest state from JotForm + workflow API.
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
          // Fire-and-forget — don't block the UI
          fetch('/api/sync-to-supabase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: syncRecords }),
          }).catch(err => console.warn('[JotFlow] Sync to Supabase failed:', err));
        } catch {} // ignore sync errors — dashboard still works from JotForm API
      } else if (forms.length === 0 && !hasCachedData) {
        setError('No JotForm workflows found. Please ensure your JotForm account has enabled forms.');
      } else if (totalRows === 0 && !hasCachedData) {
        setError('Live data unavailable — showing cached data');
      }
    } catch (err: unknown) {
      if (!hasCachedData) {
        setError(err instanceof Error ? err.message : String(err));
        setAllSubmissions([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Action cooldown: prevent real-time refresh from overwriting optimistic updates ──
  // After an approve/reject action, we suppress auto-refresh for a few seconds
  // so the optimistic update isn't overwritten with stale Supabase data.
  const actionCooldownUntil = React.useRef<number>(0);

  const startActionCooldown = useCallback((durationMs = 4000) => {
    actionCooldownUntil.current = Date.now() + durationMs;
  }, []);

  // ─── Supabase read disabled — dashboard data comes only from JotForm API ───
  // We no longer read from Supabase jf_submissions table in the dashboard.
  // Real-time and auto-refresh rely on loadData() (JotForm API) triggered by manual refresh.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadFromSupabase = useCallback(async (_opts?: { force?: boolean }) => {
    // No-op: Supabase reads removed per project requirements
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Auto-register webhooks on mount (cached for 24h) ─────────────────────
  useEffect(() => {
    const WEBHOOK_CACHE_KEY = 'jotflow_webhooks_registered';
    const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    try {
      const cached = localStorage.getItem(WEBHOOK_CACHE_KEY);
      if (cached && Date.now() - Number(cached) < WEBHOOK_CACHE_TTL) return;
      fetch('/api/register-webhooks', { method: 'POST' })
        .then(() => localStorage.setItem(WEBHOOK_CACHE_KEY, String(Date.now())))
        .catch(err => console.warn('[JotFlow] Webhook registration failed:', err));
    } catch {}
  }, []);

  // Supabase real-time subscription — lightweight refresh via Supabase query (not full JotForm re-fetch)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(loadFromSupabase, 500);
    };
    const channel = supabase
      .channel('jf_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jf_submissions' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jf_approval_history' }, handle)
      .subscribe();

    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [loadFromSupabase]);

  // Auto-refresh (1 min fallback if webhooks fail) — uses lightweight Supabase query, no loading spinner
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
  // Populated during loadData — maps formId → steps so optimistic updates
  // can resolve the next-level assignee email.
  const [stepsByForm, setStepsByForm] = useState<Record<string, WorkflowStep[]>>({});

  // ─── Optimistic update: immediately patch a submission in state ─────────────
  // Call this right after a successful write to JotForm so the UI reflects
  // the new status instantly, without waiting for the next full re-fetch.
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
        // Mark the current level as approved/rejected in history
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

        // Add pending entry for next level (if approved and not completed)
        if (!isRejected && patch.newLevel !== 'completed' && typeof patch.newLevel === 'number') {
          const nextLvl = patch.newLevel as ApprovalLevel;
          const nextExists = updatedHistory.findIndex(h => h.level === nextLvl);
          // Resolve next-level approver from workflow step config
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
        daysAtCurrentLevel: 0, // reset — just actioned
      };
    }));
  }, [stepsByForm]);

  // ─── Schedule staggered refresh after an action (catches webhook delay) ─────
  const scheduleRefreshAfterAction = useCallback(() => {
    // Start cooldown so real-time doesn't overwrite optimistic update
    startActionCooldown(4000);
    // Staggered retries: 3s, 6s, 12s — webhook usually fires within 5-10s
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
    refresh: loadData,
    refreshFromSupabase: loadFromSupabase,
    optimisticUpdate,
    scheduleRefreshAfterAction,
  };
}
