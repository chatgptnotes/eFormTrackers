import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = process.env.JOTFORM_BASE || 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY || '';
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';

/**
 * GET /api/debug-tasks?submissionId=12345
 *
 * Temporary debug endpoint — tests 3 alternative APIs to find the email button URL.
 * Compare responses to determine which API reliably returns accessLink.
 *
 * 1. GET /workflow/submission/{submissionId}/tasks         (direct task list)
 * 2. GET /API/inbox/submission/{submissionId}/thread       (notification thread)
 * 3. GET /submission/{submissionId}?addWorkflowStatus=1    (existing approach, for comparison)
 *    + GET /workflow/instance/{instanceId}
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const submissionId = req.query.submissionId as string;
  if (!submissionId) {
    return res.status(400).json({ error: 'submissionId query parameter is required' });
  }

  const authParams = `apiKey=${API_KEY}&teamID=${TEAM_ID}`;
  const results: Record<string, unknown> = { submissionId };

  // ─── Approach 1: GET /workflow/submission/{submissionId}/tasks ───
  try {
    const url = `${JOTFORM_BASE}/workflow/submission/${submissionId}/tasks?${authParams}`;
    console.log('[debug-tasks] Approach 1 URL:', url);
    const response = await fetch(url);
    const data = await response.json();
    const tasks = Array.isArray(data?.content) ? data.content : (data?.content?.taskList || []);

    // Extract key fields from each task
    const taskSummaries = (Array.isArray(tasks) ? tasks : []).map((t: Record<string, unknown>) => {
      const element = (t.element || {}) as Record<string, unknown>;
      const props = (t.properties || {}) as Record<string, unknown>;
      return {
        id: t.id,
        status: t.status,
        name: element.name || props.taskName || t.name,
        type: element.type || t.type,
        accessLink: t.accessLink || (props as any)?.accessLink || (element as any)?.accessLink || null,
        allTopLevelKeys: Object.keys(t),
        elementKeys: Object.keys(element),
        propertiesKeys: Object.keys(props),
        // Capture any field that looks like a URL
        urlFields: findUrlFields(t),
      };
    });

    results.approach1_workflowSubmissionTasks = {
      status: response.status,
      responseCode: data?.responseCode,
      message: data?.message,
      taskCount: taskSummaries.length,
      tasks: taskSummaries,
      rawContent: data?.content, // full raw response for inspection
    };
  } catch (err) {
    results.approach1_workflowSubmissionTasks = { error: String(err) };
  }

  // ─── Approach 2: GET /inbox/submission/{submissionId}/thread ───
  try {
    const url = `${JOTFORM_BASE}/inbox/submission/${submissionId}/thread?${authParams}`;
    console.log('[debug-tasks] Approach 2 URL:', url);
    const response = await fetch(url);
    const data = await response.json();

    // Look for URLs in the thread data
    const threadContent = data?.content;
    const urlFields = findUrlFields(data);

    results.approach2_inboxThread = {
      status: response.status,
      responseCode: data?.responseCode,
      message: data?.message,
      contentType: typeof threadContent,
      contentIsArray: Array.isArray(threadContent),
      contentLength: Array.isArray(threadContent) ? threadContent.length : undefined,
      urlFields,
      rawContent: data?.content, // full raw response for inspection
    };
  } catch (err) {
    results.approach2_inboxThread = { error: String(err) };
  }

  // ─── Approach 3: Existing two-step (for comparison) ───
  try {
    // Step 1: Get workflowInstanceID
    const subUrl = `${JOTFORM_BASE}/submission/${submissionId}?${authParams}&addWorkflowStatus=1`;
    const subRes = await fetch(subUrl);
    const subData = await subRes.json();
    const content = subData?.content || {};
    const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

    if (workflowInstanceID) {
      // Step 2: Get workflow instance
      const instUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?${authParams}`;
      const instRes = await fetch(instUrl);
      const instData = await instRes.json();
      const taskList: Array<Record<string, unknown>> = instData?.content?.taskList || [];

      const taskSummaries = taskList.map((t: Record<string, unknown>) => {
        const element = (t.element || {}) as Record<string, unknown>;
        const props = (t.properties || {}) as Record<string, unknown>;
        return {
          id: t.id,
          status: t.status,
          name: element.name || props.taskName || t.name,
          type: element.type || t.type,
          accessLink: t.accessLink || (props as any)?.accessLink || (element as any)?.accessLink || null,
          allTopLevelKeys: Object.keys(t),
          elementKeys: Object.keys(element),
          propertiesKeys: Object.keys(props),
          urlFields: findUrlFields(t),
        };
      });

      results.approach3_existingTwoStep = {
        workflowInstanceID,
        taskCount: taskSummaries.length,
        tasks: taskSummaries,
      };
    } else {
      results.approach3_existingTwoStep = { error: 'No workflowInstanceID found on submission' };
    }
  } catch (err) {
    results.approach3_existingTwoStep = { error: String(err) };
  }

  // ─── Summary: which approaches found accessLink? ───
  const summary: Record<string, unknown> = {};

  // Check Approach 1
  const a1 = results.approach1_workflowSubmissionTasks as any;
  if (a1?.tasks) {
    const withLink = a1.tasks.filter((t: any) => t.accessLink);
    summary.approach1 = withLink.length > 0
      ? `FOUND accessLink on ${withLink.length}/${a1.tasks.length} tasks`
      : `NO accessLink on any of ${a1.tasks.length} tasks`;
  } else {
    summary.approach1 = a1?.error || 'no tasks';
  }

  // Check Approach 2
  const a2 = results.approach2_inboxThread as any;
  if (a2?.urlFields && Object.keys(a2.urlFields).length > 0) {
    summary.approach2 = `FOUND URL fields: ${JSON.stringify(a2.urlFields)}`;
  } else {
    summary.approach2 = a2?.error || 'no URL fields found in thread';
  }

  // Check Approach 3
  const a3 = results.approach3_existingTwoStep as any;
  if (a3?.tasks) {
    const withLink = a3.tasks.filter((t: any) => t.accessLink);
    summary.approach3 = withLink.length > 0
      ? `FOUND accessLink on ${withLink.length}/${a3.tasks.length} tasks`
      : `NO accessLink on any of ${a3.tasks.length} tasks`;
  } else {
    summary.approach3 = a3?.error || 'no tasks';
  }

  results.summary = summary;

  console.log('[debug-tasks] Full results:', JSON.stringify(results, null, 2));
  return res.status(200).json(results);
}

/**
 * Recursively scan an object for any string values that look like URLs
 * (contain "http", "/share/", "accessLink", "link", "url").
 * Returns a flat map of dotted-path → value.
 */
function findUrlFields(obj: unknown, prefix = '', depth = 0): Record<string, string> {
  const found: Record<string, string> = {};
  if (depth > 5 || !obj || typeof obj !== 'object') return found;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      const lowerKey = key.toLowerCase();
      const lowerVal = value.toLowerCase();
      if (
        lowerKey.includes('link') ||
        lowerKey.includes('url') ||
        lowerKey.includes('href') ||
        lowerKey.includes('share') ||
        lowerVal.includes('/share/') ||
        (lowerVal.startsWith('http') && lowerKey !== 'ip')
      ) {
        found[path] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(found, findUrlFields(value, path, depth + 1));
    }
  }
  return found;
}
