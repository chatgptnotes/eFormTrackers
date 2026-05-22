/**
 * Workflow caches — in-memory per-tab caches for workflow steps and tasks.
 *
 * These are MODULE-LEVEL singletons (not React hooks) so multiple components
 * share the same cache without prop drilling or context.
 */
import { WorkflowActionType } from '../types';
import { apiFetch } from '../lib/api';
import { getJotformKeyType } from '../lib/jotformKey';

// ─── Workflow step type cache (per formId + keyType) ──────────────────────────
// Cache key includes the active JotForm key type because the same formId may
// resolve to different steps under Testing (default) vs Production (gdmo).
export interface WorkflowStep {
  level: number;
  type: WorkflowActionType;
  assigneeEmail?: string;
}

const workflowCache: Record<string, { steps: WorkflowStep[]; at: number }> = {};
const WORKFLOW_CACHE_TTL = 5 * 60 * 1000;

export async function fetchWorkflowSteps(formId: string): Promise<WorkflowStep[]> {
  const cacheKey = `${getJotformKeyType()}:${formId}`;
  const cached = workflowCache[cacheKey];
  if (cached && Date.now() - cached.at < WORKFLOW_CACHE_TTL) return cached.steps;
  try {
    const data = await apiFetch<{ steps?: Array<WorkflowStep & { assigneeEmail?: string }> }>(`/api/form-workflow?formId=${formId}`);
    const steps: WorkflowStep[] = (data.steps || []).map(s => ({
      level: s.level,
      type: s.type,
      assigneeEmail: s.assigneeEmail || undefined,
    }));
    workflowCache[cacheKey] = { steps, at: Date.now() };
    return steps;
  } catch {
    return [];
  }
}

export function clearWorkflowStepCache(): void {
  Object.keys(workflowCache).forEach(k => delete workflowCache[k]);
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
  taskId: string;
  internalFormID: string;
  accessLink: string;
}

export interface WorkflowTaskResult {
  tasks: WorkflowTaskInfo[];
  workflowInstanceId?: string;
}

const workflowTaskCache: Record<string, { result: WorkflowTaskResult; at: number }> = {};
const WORKFLOW_TASK_CACHE_TTL = 5 * 60 * 1000;

export async function fetchWorkflowTasks(submissionId: string): Promise<WorkflowTaskResult> {
  const cacheKey = `${getJotformKeyType()}:${submissionId}`;
  const cached = workflowTaskCache[cacheKey];
  if (cached && Date.now() - cached.at < WORKFLOW_TASK_CACHE_TTL) return cached.result;
  try {
    const data = await apiFetch<{ tasks?: Array<Record<string, unknown>>; workflowInstanceId?: string }>(`/api/workflow-tasks?submissionId=${submissionId}`);
    const tasks: WorkflowTaskInfo[] = (data.tasks || []).map((t) => ({
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
    workflowTaskCache[cacheKey] = { result, at: Date.now() };
    return result;
  } catch {
    return { tasks: [] };
  }
}

export function clearWorkflowTaskCache(): void {
  Object.keys(workflowTaskCache).forEach(k => delete workflowTaskCache[k]);
}

/** Get the workflow task approver for a given submission + level */
export function getWorkflowTaskApprover(
  tasks: WorkflowTaskInfo[],
  level: number,
): { name: string; email: string } | null {
  const task = tasks.find(t => t.level === level);
  if (task && (task.assigneeName || task.assigneeEmail)) {
    return { name: task.assigneeName, email: task.assigneeEmail };
  }
  return null;
}

export function getActionType(steps: WorkflowStep[], currentLevel: number | string): WorkflowActionType {
  if (typeof currentLevel !== 'number') return 'approval';
  const step = steps.find(s => s.level === currentLevel);
  return step?.type ?? 'approval';
}
