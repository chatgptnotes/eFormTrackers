/**
 * Shared workflow instance fetcher — single source of truth for workflow state.
 *
 * Two-step chain:
 *   1. GET /submission/{id}?addWorkflowStatus=1 → extract workflowInstanceID
 *   2. GET /workflow/instance/{instanceId}       → extract taskList
 *
 * Used by: workflow-tasks.ts (client API) and webhook.ts (server-side sync).
 */

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';

export interface WorkflowTask {
  name: string;
  status: string;        // "COMPLETED", "ACTIVE", "PENDING"
  assigneeName: string;
  assigneeEmail: string;
  level: number;          // sequential position (1, 2, 3, ...)
  updatedAt: string;
}

/** Extract a single task from JotForm's nested workflow instance structure */
function extractTask(t: Record<string, unknown>) {
  const element = (t.element || {}) as Record<string, unknown>;
  const props = (t.properties || {}) as Record<string, unknown>;
  const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
  const recipients = Array.isArray(props.recipients) ? props.recipients : [];
  const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;

  const name = String(element.name || props.taskName || t.name || '');
  const assigneeName = String(assigneeUser.name || firstRecipient.name || t.assignee_name || '');
  const assigneeEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee || '');
  const status = String(t.status || 'PENDING').toUpperCase();
  const updatedAt = String(t.updated_at || '');

  return { name, status, assigneeName, assigneeEmail, updatedAt };
}

/**
 * Fetch normalized workflow tasks for a submission from JotForm's workflow instance API.
 * Returns [] if the submission has no workflow or the API fails.
 */
export async function fetchWorkflowInstance(
  submissionId: string,
  apiKey: string,
  teamId: string,
): Promise<WorkflowTask[]> {
  // Step 1: Get workflowInstanceID from submission
  const submissionUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${apiKey}&teamID=${teamId}&addWorkflowStatus=1`;
  const submissionRes = await fetch(submissionUrl);
  if (!submissionRes.ok) {
    throw new Error(`JotForm submission API error: ${submissionRes.status}`);
  }
  const submissionData = await submissionRes.json();
  const content = submissionData?.content || submissionData;
  const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

  if (!workflowInstanceID) return [];

  // Step 2: Fetch workflow instance for full taskList
  const instanceUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?apiKey=${apiKey}&teamID=${teamId}`;
  const instanceRes = await fetch(instanceUrl);
  if (!instanceRes.ok) {
    if (instanceRes.status === 404) return [];
    throw new Error(`JotForm workflow instance API error: ${instanceRes.status}`);
  }
  const instanceData = await instanceRes.json();
  const rawTaskList: Array<Record<string, unknown>> =
    instanceData?.content?.taskList || instanceData?.taskList || [];

  // Filter out the initial "Form" submission step (COMPLETED with no assignee)
  const filteredTasks = rawTaskList.filter((t) => {
    const { name, status, assigneeEmail } = extractTask(t);
    if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
    return true;
  });

  // Normalize and number sequentially
  return filteredTasks.map((t, index) => {
    const { name, status, assigneeName, assigneeEmail, updatedAt } = extractTask(t);
    return { name, status, assigneeName, assigneeEmail, level: index + 1, updatedAt };
  });
}

/**
 * Derive workflow summary from task list:
 * - currentLevel, status, pendingApprover, actionType
 */
export function deriveWorkflowState(tasks: WorkflowTask[]) {
  if (tasks.length === 0) return null;

  const allCompleted = tasks.every(t => t.status === 'COMPLETED');
  const activeTask = tasks.find(t => t.status === 'ACTIVE');

  if (allCompleted) {
    return {
      status: 'completed' as const,
      currentLevel: 'completed' as const,
      activeTask: null,
      pendingApproverName: '',
      pendingApproverEmail: '',
      jotformStatus: 'Completed',
      actionType: 'approval' as 'approval' | 'task' | 'form',
    };
  }

  if (activeTask) {
    const stepName = activeTask.name.toLowerCase();
    let actionType: 'approval' | 'task' | 'form' = 'approval';
    if (stepName.includes('task') || stepName.includes('review task')) {
      actionType = 'task';
    } else if (stepName.includes('form') || stepName.includes('view form')) {
      actionType = 'form';
    }

    return {
      status: 'pending' as const,
      currentLevel: activeTask.level,
      activeTask,
      pendingApproverName: activeTask.assigneeName,
      pendingApproverEmail: activeTask.assigneeEmail,
      jotformStatus: `${activeTask.name} Pending`,
      actionType,
    };
  }

  // No active, not all completed — some are PENDING (waiting)
  const pendingTask = tasks.find(t => t.status === 'PENDING');
  return {
    status: 'pending' as const,
    currentLevel: pendingTask?.level || 1,
    activeTask: null,
    pendingApproverName: pendingTask?.assigneeName || '',
    pendingApproverEmail: pendingTask?.assigneeEmail || '',
    jotformStatus: pendingTask ? `${pendingTask.name} Pending` : 'Pending',
    actionType: 'approval' as 'approval' | 'task' | 'form',
  };
}
