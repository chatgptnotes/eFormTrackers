import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export interface WorkflowTask {
  name: string;
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

    // Filter out the initial Form submission step (COMPLETED with no meaningful assignee, name === "Form")
    const filteredTasks = rawTaskList.filter((t) => {
      const name = String(t.name || '').trim();
      const status = String(t.status || '').toUpperCase();
      const assignee = String(t.assignee || '').trim();
      // Remove the initial "Form" step that is just the submission itself
      if (name === 'Form' && status === 'COMPLETED' && !assignee) return false;
      return true;
    });

    // Normalize and number sequentially
    const tasks: WorkflowTask[] = filteredTasks.map((t, index) => ({
      name: String(t.name || ''),
      status: String(t.status || 'PENDING').toUpperCase(),
      assigneeName: String(t.assignee_name || t.assigneeName || ''),
      assigneeEmail: String(t.assignee || t.assignee_email || t.assigneeEmail || ''),
      level: index + 1,
      updatedAt: String(t.updated_at || t.updatedAt || t.completed_at || ''),
    }));

    // Include raw sample for debugging (first task only)
    const debugSample = rawTaskList.length > 0 ? { keys: Object.keys(rawTaskList[0]), firstTask: rawTaskList[0] } : null;
    return res.status(200).json({ tasks, debug: debugSample });
  } catch (error) {
    console.error('workflow-tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow tasks', message: String(error) });
  }
}
