import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Submission, ApprovalEntry, ApprovalLevel, FilterConfig, SortConfig, PaginationConfig, RefreshConfig, WorkflowActionType } from '../types';
import { getDashboardStats, getApprovalLevelStats, getDepartmentStats, getTrendData, getBottleneckData, getHeatmapData } from '../services/mockData';
import { apiFetch } from '../lib/api';
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
    Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
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

    // ── OPTIMIZATION: Show cached data immediately on load ──────────────────
    // Load from localStorage first (hot reload cache) for instant display
    // Then fetch fresh data in background
    const cacheKey = 'jotflow_submissions_cache';
    let hasCachedData = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached && !force) {
        const { submissions, forms, timestamp } = JSON.parse(cached);
        // Use cache if less than 30 minutes old
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

    // ── Fetch all forms + submissions fresh from JotForm ─────────────────────
    try {
      // Discover all enabled JotForm workflows for this account (no fire-and-forget sync)
      const forms = await fetchUserForms();
      // Persist this account's form IDs so loadFromSupabase can scope its query
      // and never paint rows belonging to a previous JOTFORM_API_KEY.
      try {
        localStorage.setItem('jotflow_active_form_ids', JSON.stringify(forms.map(f => f.id)));
      } catch { /* ignore */ }
      // Don't setActiveForms yet — wait until submissions are ready to avoid mid-load flicker

      // ── OPTIMIZATION: Fetch questions + submissions + workflow steps in parallel ──
      // Don't wait for questions before starting submissions fetch
      let partialDataWarning = false;
      const formResults = await Promise.all(
        forms.map(async (form) => {
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
              return rows;
            })(),
            fetchWorkflowSteps(form.id),
          ]);

          const detectedFields = detectFields(questions);
          return { form, rows, detectedFields, steps };
        })
      );

      const totalRows = formResults.reduce((sum, r) => sum + r.rows.length, 0);

      if (totalRows > 0) {
        const mapped: Submission[] = [];
        const newStepsByForm: Record<string, WorkflowStep[]> = {};

        // ── OPTIMIZATION: Skip dynamic approver detection on initial load (expensive O(n²) scan) ──
        // Load manual approver configs only, defer dynamic detection to background
        let mergedConfigs: ApproverConfig[] = [];
        try {
          const manualConfigs = await fetchApproverConfigs();
          mergedConfigs = [...manualConfigs];
          console.log('[useSubmissions] Loaded', mergedConfigs.length, 'manual approver configs');
        } catch (e) {
          console.warn('[useSubmissions] Failed to fetch approver configs:', e);
        }

        // Dynamic approver detection will be done in background (non-blocking)
        // This allows initial load to proceed without scanning all submissions

        // First pass: map all submissions with dynamic approver data
        for (const { form, rows, detectedFields, steps } of formResults) {
          newStepsByForm[form.id] = steps;
          for (const raw of rows) {
            mapped.push(mapGenericSubmission(raw, form.id, form.title, detectedFields, steps, [], mergedConfigs));
          }
        }

        // Second pass: batch-fetch REAL workflow tasks for PENDING submissions only.
        // Skip rows that already have complete approver data from Supabase first-paint /
        // the bulk submissions API — webhook keeps these fresh, so re-fetching is waste.
        const needsEnrichment = (s: Submission): boolean => {
          if (typeof s.currentApprovalLevel === 'number') {
            // Pending: only fetch if real approver email is missing or workflow instance unknown
            if (!s.pendingApproverEmail || !s.workflowInstanceId) return true;
            return false;
          }
          // Completed/rejected: only fetch when workflow instance ID is missing (grouping)
          return !s.workflowInstanceId;
        };
        const pendingSubs = mapped.filter(needsEnrichment).slice(0, 100);
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

        // Third pass: fetch approval comments from jf_approval_history table
        const submissionIds = mapped.map(s => s.id);
        if (submissionIds.length > 0) {
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

        // Batch state updates together — prevents double render / flicker
        setStepsByForm(newStepsByForm);
        setActiveForms(forms);
        setAllSubmissions(mapped);
        setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
        if (partialDataWarning) {
          setError('Some submissions could not be loaded — showing partial data');
        }

        // ── OPTIMIZATION: Cache to localStorage for hot reload ──────────────
        // Save submissions and forms to localStorage for instant display on next load
        try {
          localStorage.setItem('jotflow_submissions_cache', JSON.stringify({
            submissions: mapped,
            forms: forms,
            timestamp: Date.now(),
          }));
          console.log('[useSubmissions] Cached', mapped.length, 'submissions to localStorage');
        } catch (e) {
          console.warn('[useSubmissions] Failed to cache to localStorage:', e);
        }

        // ── Delta sync to Supabase — only push records that actually changed ──
        // Webhook keeps Supabase live for individual events; this catches anything
        // the webhook missed (e.g., backfills, missed deliveries). We hash each
        // record by the fields that drive the dashboard and skip unchanged rows.
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

  // ─── Supabase live-mirror read — fast first paint + webhook-driven refresh ──
  // Webhook keeps jf_submissions live; reading it is ~100ms vs seconds for JotForm.
  // Used for: initial paint, real-time event refresh, 1-min auto-refresh.
  // JotForm remains the source of truth via loadData() — Supabase is the cache.
  //
  // CRITICAL: scope by active form IDs so rows written under a previous
  // JOTFORM_API_KEY (e.g. GDMO data still in Supabase) don't leak into the
  // dashboard when the current key only has access to a smaller form set.
  const loadFromSupabase = useCallback(async (opts?: { force?: boolean }) => {
    // Skip while action cooldown is active so optimistic updates aren't overwritten
    if (!opts?.force && Date.now() < actionCooldownUntil.current) return;

    // Read the current account's accessible form IDs. If we don't know them yet
    // (cold start, before loadData has run), skip — better to wait for JotForm
    // than paint stale rows belonging to a different API key.
    let activeFormIds: string[] = [];
    try {
      const raw = localStorage.getItem('jotflow_active_form_ids');
      if (raw) activeFormIds = JSON.parse(raw);
    } catch { /* ignore */ }
    if (activeFormIds.length === 0) return;

    try {
      const data = await apiFetch<Record<string, unknown>[]>(
        `/api/submissions?form_ids=${activeFormIds.join(',')}&limit=2000&order=desc`
      );
      if (!data || data.length === 0) return; // never wipe state with empty result

      const mapped = data.map(row => mapSupabaseRow(row as Record<string, unknown>));
      setAllSubmissions(mapped);
      setRefreshConfig(prev => ({ ...prev, lastUpdated: new Date().toISOString() }));
    } catch (err) {
      console.warn('[useSubmissions] Supabase refresh failed:', err);
    }
  }, []);

  // On mount: paint from Supabase immediately (fast), then refresh from JotForm
  useEffect(() => {
    loadFromSupabase();
    loadData();
  }, [loadData, loadFromSupabase]);

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

  // Polling fallback — replaces Supabase realtime channel.
  // Polls every 30s for near-real-time updates without WebSocket dependency.
  useEffect(() => {
    const interval = setInterval(loadFromSupabase, 30_000);
    return () => clearInterval(interval);
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
    // Invalidate localStorage cache so reload after action doesn't show stale data
    try { localStorage.removeItem('jotflow_submissions_cache'); } catch { /* ignore */ }
    // Staggered retries: 3s, 6s, 12s — webhook usually fires within 5-10s.
    // Use loadData (full JotForm refetch) since loadFromSupabase is a no-op.
    const timers = [3000, 6000, 12000].map(ms =>
      setTimeout(() => loadData({ force: true }), ms)
    );
    return () => timers.forEach(t => clearTimeout(t));
  }, [loadData, startActionCooldown]);

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
