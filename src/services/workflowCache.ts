import { WorkflowActionType } from '../types';

// ─── Workflow step type cache (per formId) ────────────────────────────────────
export interface WorkflowStep { level: number; type: WorkflowActionType; assigneeEmail?: string; }
const workflowCache: Record<string, { steps: WorkflowStep[]; at: number }> = {};
const WORKFLOW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — re-fetches on each page session

export async function fetchWorkflowSteps(formId: string): Promise<WorkflowStep[]> {
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
export interface WorkflowTaskInfo {
  name: string;
  type: string;
  level: number;
  assigneeName: string;
  assigneeEmail: string;
  status: string;
  updatedAt: string;
}
const workflowTaskCache: Record<string, { tasks: WorkflowTaskInfo[]; at: number }> = {};
const WORKFLOW_TASK_CACHE_TTL = 5 * 60 * 1000;

export async function fetchWorkflowTasks(submissionId: string): Promise<WorkflowTaskInfo[]> {
  const cached = workflowTaskCache[submissionId];
  if (cached && Date.now() - cached.at < WORKFLOW_TASK_CACHE_TTL) return cached.tasks;
  try {
    const res = await fetch(`/api/workflow-tasks?submissionId=${submissionId}`);
    if (!res.ok) return [];
    const data = await res.json();
    const tasks: WorkflowTaskInfo[] = (data.tasks || []).map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      type: String(t.type || ''),
      level: Number(t.level || 0),
      assigneeName: String(t.assigneeName || ''),
      assigneeEmail: String(t.assigneeEmail || ''),
      status: String(t.status || 'PENDING').toUpperCase(),
      updatedAt: String(t.updatedAt || ''),
    }));
    workflowTaskCache[submissionId] = { tasks, at: Date.now() };
    return tasks;
  } catch {
    return [];
  }
}

/** Get the workflow task approver for a given submission + level */
export function getWorkflowTaskApprover(tasks: WorkflowTaskInfo[], level: number): { name: string; email: string } | null {
  const task = tasks.find(t => t.level === level);
  if (task && (task.assigneeName || task.assigneeEmail)) {
    return { name: task.assigneeName, email: task.assigneeEmail };
  }
  return null;
}

// ─── Approval thread cache (per submissionId) — real comments/history from inbox ─
export interface ApprovalThreadEntry {
  actor?: string;
  action?: string;
  comment?: string;
  timestamp?: string;
  [key: string]: unknown;
}
const approvalThreadCache: Record<string, { thread: ApprovalThreadEntry[]; at: number }> = {};
const APPROVAL_THREAD_CACHE_TTL = 5 * 60 * 1000;

export async function fetchApprovalThread(submissionId: string, forceRefresh = false): Promise<ApprovalThreadEntry[]> {
  if (!forceRefresh) {
    const cached = approvalThreadCache[submissionId];
    if (cached && Date.now() - cached.at < APPROVAL_THREAD_CACHE_TTL) return cached.thread;
  }
  try {
    const res = await fetch(`/api/approval-thread?submissionId=${submissionId}`);
    if (!res.ok) return [];
    const data = await res.json();
    const thread: ApprovalThreadEntry[] = Array.isArray(data.thread) ? data.thread : [];
    approvalThreadCache[submissionId] = { thread, at: Date.now() };
    return thread;
  } catch {
    return [];
  }
}

// ─── Approver config cache (from Supabase jf_approver_config table) ────────
export interface ApproverConfig { formId: string; level: number; approverName: string; approverEmail: string; }
let approverConfigCache: { configs: ApproverConfig[]; at: number } | null = null;
const APPROVER_CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export async function fetchApproverConfigs(): Promise<ApproverConfig[]> {
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

export function getConfiguredApprover(configs: ApproverConfig[], formId: string, level: number): { name: string; email: string } | null {
  const config = configs.find(c => c.formId === formId && c.level === level);
  if (config && (config.approverName || config.approverEmail)) {
    return { name: config.approverName, email: config.approverEmail };
  }
  return null;
}

// ─── Workspace version — bump when switching teams to force full cache clear ──
const WORKSPACE_VERSION = 'gdmo-bettroi-v3'; // bumped: force cache clear after new Vercel deploy
const WS_VERSION_KEY = 'jotflow_workspace_version';

export function checkAndClearWorkspaceCaches() {
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
export function clearAllJotFlowCaches() {
  // Clear localStorage caches used by formDiscovery
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('jotflow_')) localStorage.removeItem(k);
  });
  // Clear in-process workflow step cache
  Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
  // Clear workflow task cache (per-submission real workflow data)
  Object.keys(workflowTaskCache).forEach(k => delete workflowTaskCache[k]);
  // Clear approval thread cache
  Object.keys(approvalThreadCache).forEach(k => delete approvalThreadCache[k]);
  // Clear approver config cache
  approverConfigCache = null;
}
