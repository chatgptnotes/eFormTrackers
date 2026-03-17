import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://jot-14march.vercel.app';

export interface WorkflowTask {
  name: string;
  type: string;           // "workflow_approval", "workflow_assign_task", "workflow_assign_form", etc.
  status: string;        // "COMPLETED", "ACTIVE", "PENDING"
  assigneeName: string;
  assigneeEmail: string;
  level: number;          // sequential position (1, 2, 3, ...)
  updatedAt: string;
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
    // Extract data from task objects — handles both nested (instance API) and flat (direct API) formats
    const extractTask = (t: Record<string, unknown>) => {
      const element = (t.element || {}) as Record<string, unknown>;
      const props = (t.properties || {}) as Record<string, unknown>;
      const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
      const recipients = Array.isArray(props.recipients) ? props.recipients : [];
      const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;

      // Name: nested element.name → props.taskName → flat t.name
      const name = String(element.name || props.taskName || t.name || '');
      // Type: nested element.type → flat t.type
      const type = String(element.type || t.type || '');
      // Assignee name: nested → flat snake_case
      const assigneeName = String(assigneeUser.name || firstRecipient.name || t.assignee_name || t.assigneeName || '');
      // Assignee email: nested → flat snake_case
      const assigneeEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee_email || t.assignee || '');
      const status = String(t.status || 'PENDING').toUpperCase();
      const updatedAt = String(t.updated_at || t.updatedAt || '');

      return { name, type, status, assigneeName, assigneeEmail, updatedAt };
    };

    // Try direct endpoint first: GET /workflow/submission/{submissionId}/tasks (single API call)
    let rawTaskList: Array<Record<string, unknown>> | null = null;

    try {
      const directUrl = `${JOTFORM_BASE}/workflow/submission/${submissionId}/tasks?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
      const directRes = await fetch(directUrl);
      if (directRes.ok) {
        const directData = await directRes.json();
        const content = directData?.content;
        if (Array.isArray(content)) {
          rawTaskList = content;
        } else if (content?.taskList && Array.isArray(content.taskList)) {
          rawTaskList = content.taskList;
        }
      }
    } catch {
      // Direct endpoint failed — fall through to 2-step chain
    }

    // Fallback: 2-step chain (submission → workflowInstanceID → instance)
    if (rawTaskList === null) {
      const submissionUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
      const submissionRes = await fetch(submissionUrl);
      if (!submissionRes.ok) {
        throw new Error(`JotForm submission API error: ${submissionRes.status}`);
      }
      const submissionData = await submissionRes.json();
      const content = submissionData?.content || submissionData;
      const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

      if (!workflowInstanceID) {
        return res.status(200).json({ tasks: [] });
      }

      const instanceUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
      const instanceRes = await fetch(instanceUrl);
      if (!instanceRes.ok) {
        if (instanceRes.status === 404) {
          return res.status(200).json({ tasks: [] });
        }
        throw new Error(`JotForm workflow instance API error: ${instanceRes.status}`);
      }
      const instanceData = await instanceRes.json();
      rawTaskList = instanceData?.content?.taskList || instanceData?.taskList || [];
    }

    // Filter out the initial "Form" submission step (COMPLETED with no assignee)
    const filteredTasks = rawTaskList.filter((t) => {
      const { name, status, assigneeEmail } = extractTask(t);
      if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
      return true;
    });

    // Normalize and number sequentially
    const tasks: WorkflowTask[] = filteredTasks.map((t, index) => {
      const { name, type, status, assigneeName, assigneeEmail, updatedAt } = extractTask(t);
      return { name, type, status, assigneeName, assigneeEmail, level: index + 1, updatedAt };
    });

    return res.status(200).json({ tasks });
  } catch (error) {
    console.error('workflow-tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow tasks', message: String(error) });
  }
}
