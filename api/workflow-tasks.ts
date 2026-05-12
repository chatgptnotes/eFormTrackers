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
  submittedBy: string;     // who completed/submitted this task (name)
  submittedByEmail: string; // who completed/submitted this task (email)
  formData?: Record<string, { label: string; value: string }>;
}

/**
 * GET /api/workflow-tasks?submissionId=12345&workflowInstanceId=xyz
 *
 * Optimized approach:
 * 1. If workflowInstanceId provided, skip submission fetch (pre-fetched on frontend)
 * 2. If not provided, fetch submission with addWorkflowStatus=1 → get workflowInstanceID
 * 3. Fetch /workflow/instance/{instanceId} → get full taskList
 * 4. Return normalized tasks (filtering out initial Form submission step)
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
  const providedWorkflowId = req.query.workflowInstanceId as string | undefined;
  if (!submissionId) {
    return res.status(400).json({ error: 'submissionId query parameter is required' });
  }

  try {
    let workflowInstanceID = providedWorkflowId;

    // Skip submission fetch if workflowInstanceId already provided (pre-fetched on frontend)
    if (!workflowInstanceID) {
      console.log(`[workflow-tasks] Fetching submission ${submissionId} to get workflowInstanceID...`);
      // Step 1: Fetch submission with workflow status to get workflowInstanceID
      const submissionUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
      const submissionRes = await fetch(submissionUrl);
      if (!submissionRes.ok) {
        throw new Error(`JotForm submission API error: ${submissionRes.status}`);
      }
      const submissionData = await submissionRes.json();
      const content = submissionData?.content || submissionData;
      workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;
    }

    if (!workflowInstanceID) {
      // No workflow instance — return empty tasks
      console.log(`[workflow-tasks] No workflowInstanceID found for submission ${submissionId}`);
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
    const extractTask = (t: Record<string, unknown>, idx: number) => {
      const element = (t.element || {}) as Record<string, unknown>;
      const props = (t.properties || {}) as Record<string, unknown>;
      const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
      const recipients = Array.isArray(props.recipients) ? props.recipients : [];
      const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;
      const result = (t.result || {}) as Record<string, unknown>;
      const completedBy = (t.completedBy || t.completed_by || {}) as Record<string, unknown>;

      // Debug: log raw task keys to discover submitter fields
      console.log(`[workflow-tasks] Task #${idx} raw keys:`, Object.keys(t));
      console.log(`[workflow-tasks] Task #${idx} props keys:`, Object.keys(props));
      if (Object.keys(result).length > 0) console.log(`[workflow-tasks] Task #${idx} result keys:`, Object.keys(result));
      if (Object.keys(completedBy).length > 0) console.log(`[workflow-tasks] Task #${idx} completedBy:`, completedBy);

      const name = String(element.name || props.taskName || t.name || '');
      const type = String(element.type || '');
      const assigneeName = String(assigneeUser.name || firstRecipient.name || t.assignee_name || '');
      const assigneeEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee || '');
      const status = String(t.status || 'PENDING').toUpperCase();
      const updatedAt = String(t.updated_at || '');
      const taskId = String(t.id || '');
      const internalFormID = String(element.internalFormID || element.resourceID || element.formID || props.formID || '');
      const accessLink = String(t.accessLink || '');

      // Submitter: try completedBy, result, then fallback to assignee for completed tasks
      const submittedBy = String(completedBy.name || result.submittedBy || result.completed_by ||
        (status === 'COMPLETED' ? assigneeName : '') || '');
      const submittedByEmail = String(completedBy.email || result.submittedByEmail || result.completed_by_email ||
        (status === 'COMPLETED' ? assigneeEmail : '') || '');

      return { name, type, status, assigneeName, assigneeEmail, updatedAt, taskId, internalFormID, accessLink, submittedBy, submittedByEmail };
    };

    // Filter out the initial "Form" submission step (COMPLETED with no assignee)
    const filteredTasks = rawTaskList.filter((t, i) => {
      const { name, status, assigneeEmail } = extractTask(t, i);
      if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
      return true;
    });

    // Normalize and number sequentially
    const tasks: WorkflowTask[] = filteredTasks.map((t, index) => {
      const { name, type, status, assigneeName, assigneeEmail, updatedAt, taskId, internalFormID, accessLink, submittedBy, submittedByEmail } = extractTask(t, index);
      return { name, type, status, assigneeName, assigneeEmail, level: index + 1, updatedAt, taskId, internalFormID, accessLink, submittedBy, submittedByEmail };
    });

    // Step 3: Return workflow tasks immediately (form data will be fetched in background if needed)
    console.log('[workflow-tasks] Returning', tasks.length, 'workflow tasks (form data is optional/deferred)');

    // Optionally fetch form data in background (non-blocking) if requested
    if (req.query.includeForms === 'true') {
      // This is a non-blocking fetch - don't await it
      (async () => {
        try {
          console.log('[workflow-tasks] Starting background form data fetch...');
          const isFormTaskType = (type: string) => {
            const lower = type.toLowerCase();
            return lower === 'workflow_assign_task' || lower === 'workflow_assign_form' ||
                   lower.includes('form') || lower.includes('task');
          };
          const completedFormTasks = tasks.filter(
            t => isFormTaskType(t.type) && t.status === 'COMPLETED' && t.internalFormID
          );
          const uniqueFormIDs = [...new Set(completedFormTasks.map(t => t.internalFormID))];

          const formSubmissionsMap = new Map<string, Array<Record<string, unknown>>>();
          await Promise.all(
            uniqueFormIDs.map(async (formID) => {
              try {
                const subUrl = `${JOTFORM_BASE}/form/${formID}/submissions?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=50`;
                const subRes = await fetch(subUrl);
                if (subRes.ok) {
                  const subData = await subRes.json();
                  const submissions = Array.isArray(subData?.content) ? subData.content : [];
                  formSubmissionsMap.set(formID, submissions);
                }
              } catch (e) {
                console.error(`[workflow-tasks] Background: Failed to fetch form ${formID}:`, e);
              }
            })
          );

          for (const task of tasks) {
            if (!isFormTaskType(task.type) || task.status !== 'COMPLETED' || !task.internalFormID) continue;
            const submissions = formSubmissionsMap.get(task.internalFormID);
            if (!submissions || submissions.length === 0) continue;

            let matched: Record<string, unknown>;
            if (submissions.length === 1) {
              matched = submissions[0];
            } else {
              const matchEmail = (task.submittedByEmail || task.assigneeEmail || '').toLowerCase();
              const emailMatch = submissions.find((s: Record<string, unknown>) => {
                const answers = s.answers as Record<string, Record<string, unknown>> | undefined;
                const createdBy = String(s.created_by || '').toLowerCase();
                if (matchEmail && createdBy === matchEmail) return true;
                const sEmail = String((s as Record<string, unknown>).email || '').toLowerCase();
                if (matchEmail && sEmail && sEmail === matchEmail) return true;
                if (!answers) return false;
                for (const ans of Object.values(answers)) {
                  if (ans.type === 'control_email' && String(ans.answer || '').toLowerCase() === matchEmail) return true;
                }
                return false;
              });
              matched = emailMatch || submissions[0];
            }

            const answers = (matched as Record<string, unknown>).answers as Record<string, Record<string, unknown>> | undefined;
            if (!answers) continue;

            const formData: Record<string, { label: string; value: string }> = {};
            for (const [qid, ans] of Object.entries(answers)) {
              const label = String(ans.text || ans.name || '');
              let value = '';
              if (ans.answer != null) {
                if (typeof ans.answer === 'object' && !Array.isArray(ans.answer)) {
                  value = Object.values(ans.answer as Record<string, string>).filter(Boolean).join(' ');
                } else if (Array.isArray(ans.answer)) {
                  value = ans.answer.join(', ');
                } else {
                  value = String(ans.answer);
                }
              }
              if (label && value) {
                formData[qid] = { label, value };
              }
            }
            if (Object.keys(formData).length > 0) {
              task.formData = formData;
            }
          }
          console.log('[workflow-tasks] Background form data fetch completed');
        } catch (e) {
          console.error('[workflow-tasks] Background form data fetch failed:', e);
        }
      })();
    }

    return res.status(200).json({ tasks, workflowInstanceId: workflowInstanceID });
  } catch (error) {
    console.error('workflow-tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch workflow tasks', message: String(error) });
  }
}
