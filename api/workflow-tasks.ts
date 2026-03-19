import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export interface WorkflowTask {
  name: string;
  type: string;           // "workflow_approval", "workflow_assign_task", "workflow_assign_form", etc.
  status: string;        // "COMPLETED", "ACTIVE", "PENDING"
  assigneeName: string;
  assigneeEmail: string;
  level: number;          // sequential position (1, 2, 3, ...)
  updatedAt: string;
  taskId: string;          // workflow task ID (used to build approval/form URLs)
  internalFormID: string;  // internal form ID for workflow-aware URLs
  accessLink: string;      // direct URL with access token from JotForm
}

/**
 * GET /api/workflow-tasks?submissionId=12345
 *
 * Two-step approach (v2):
 * 1. Fetch submission with addWorkflowStatus=1 → get workflowInstanceID
 * 2. Fetch /workflow/instance/{instanceId} → get full taskList
 * 3. Return normalized tasks (filtering out initial Form submission step)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  const submissionId = req.query.submissionId as string;
  if (!submissionId) {
    return res.status(400).json({ error: 'submissionId query parameter is required' });
  }

  try {
    // Step 1: Fetch submission with workflow status to get workflowInstanceID
    const submissionUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
    const submissionRes = await fetch(submissionUrl);
    if (!submissionRes.ok) {
      throw new Error(`JotForm submission API error: ${submissionRes.status}`);
    }
    const submissionData = await submissionRes.json();
    const content = submissionData?.content || submissionData;
    const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

    if (!workflowInstanceID) {
      // No workflow instance — return empty tasks
      return res.status(200).json({ tasks: [] });
    }

    // Step 2: Fetch workflow instance to get full taskList
    const instanceUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const instanceRes = await fetch(instanceUrl);
    if (!instanceRes.ok) {
      if (instanceRes.status === 404) {
        return res.status(200).json({ tasks: [] });
      }
      throw new Error(`JotForm workflow instance API error: ${instanceRes.status}`);
    }
    const instanceData = await instanceRes.json();
    const rawTaskList: Array<Record<string, unknown>> =
      instanceData?.content?.taskList || instanceData?.taskList || [];

    // Extract data from nested structure:
    // - Step name: element.name or properties.taskName
    // - Assignee name: properties.assigneeUser.name or properties.recipients[0].name
    // - Assignee email: properties.assigneeEmail or properties.assigneeUser.email
    const extractTask = (t: Record<string, unknown>) => {
      const element = (t.element || {}) as Record<string, unknown>;
      const props = (t.properties || {}) as Record<string, unknown>;
      const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
      const recipients = Array.isArray(props.recipients) ? props.recipients : [];
      const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;

      const name = String(element.name || props.taskName || t.name || '');
      const type = String(element.type || '');
      const assigneeName = String(assigneeUser.name || firstRecipient.name || t.assignee_name || '');
      const assigneeEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee || '');
      const status = String(t.status || 'PENDING').toUpperCase();
      const updatedAt = String(t.updated_at || '');
      const taskId = String(t.id || '');
      const internalFormID = String(element.internalFormID || element.resourceID || element.formID || props.formID || '');
      const accessLink = String(t.accessLink || '');

      return { name, type, status, assigneeName, assigneeEmail, updatedAt, taskId, internalFormID, accessLink };
    };

    // Filter out the initial "Form" submission step (COMPLETED with no assignee)
    const filteredTasks = rawTaskList.filter((t) => {
      const { name, status, assigneeEmail } = extractTask(t);
      if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
      return true;
    });

    // Normalize and number sequentially
    const tasks: WorkflowTask[] = filteredTasks.map((t, index) => {
      const { name, type, status, assigneeName, assigneeEmail, updatedAt, taskId, internalFormID, accessLink } = extractTask(t);
      return { name, type, status, assigneeName, assigneeEmail, level: index + 1, updatedAt, taskId, internalFormID, accessLink };
    });

    return res.status(200).json({ tasks });
  } catch (error) {
    console.error('workflow-tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow tasks', message: String(error) });
  }
}
