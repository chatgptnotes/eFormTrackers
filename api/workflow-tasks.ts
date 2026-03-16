import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export interface WorkflowTask {
  id: string;
  level: number;
  assigneeName: string;
  assigneeEmail: string;
  status: string;
  outcome: string;
  actionedAt: string | null;
}

/**
 * GET /api/workflow-tasks?submissionId=12345
 *   → Proxies to JotForm Workflow API to get actual task/approver info
 *
 * GET /api/workflow-tasks?submissionId=12345&mode=status
 *   → Fetches submission with addWorkflowStatus=1 for native workflow status
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

  const mode = (req.query.mode as string) || 'tasks';

  try {
    if (mode === 'status') {
      // Fetch submission with workflow status
      const url = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`JotForm API error: ${response.status}`);
      const data = await response.json();
      return res.status(200).json(data);
    }

    // Default: fetch workflow tasks for this submission
    const url = `${JOTFORM_BASE}/workflow/submission/${submissionId}/tasks?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const response = await fetch(url);

    if (!response.ok) {
      // Workflow API may return 404 if no workflow is configured — that's OK
      if (response.status === 404) {
        return res.status(200).json({ content: [], tasks: [] });
      }
      throw new Error(`JotForm Workflow API error: ${response.status}`);
    }

    const data = await response.json();
    const rawTasks = Array.isArray(data.content) ? data.content : [];

    // Normalize tasks into a clean structure
    const tasks: WorkflowTask[] = rawTasks.map((t: Record<string, unknown>, index: number) => ({
      id: String(t.id || index),
      level: Number(t.step || t.level || index + 1),
      assigneeName: String(t.assignee_name || t.assigneeName || t.name || ''),
      assigneeEmail: String(t.assignee_email || t.assigneeEmail || t.email || ''),
      status: String(t.status || 'pending').toLowerCase(),
      outcome: String(t.outcome || t.action || ''),
      actionedAt: t.actioned_at || t.actionedAt || t.completed_at || null,
    }));

    return res.status(200).json({ tasks });
  } catch (error) {
    console.error('workflow-tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow tasks', message: String(error) });
  }
}
