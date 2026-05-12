import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = process.env.JOTFORM_BASE || 'https://eforms.mediaoffice.ae/API';
const JOTFORM_HOST = process.env.JOTFORM_HOST || 'https://eforms.mediaoffice.ae';
const JOTFORM_API_KEY = process.env.JOTFORM_API_KEY || '';
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';

/**
 * GET /api/email-url?formId={id}&submissionId={id}
 *
 * Returns the direct task URL in the same path-based format JotForm uses in email notifications:
 *   /approval-form/{formID}/task/{taskID}/access-token/{token}
 *
 * The access token is extracted from the accessLink (/share/ URL) returned by the workflow API.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { formId, submissionId } = req.query as { formId: string; submissionId: string };
  if (!formId || !submissionId) {
    return res.status(400).json({ error: 'formId and submissionId required' });
  }

  try {
    const subUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${JOTFORM_API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
    const subRes = await fetch(subUrl);
    if (!subRes.ok) throw new Error(`Submission API error: ${subRes.status}`);
    const subData = await subRes.json();
    const content = subData?.content || {};
    const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

    if (!workflowInstanceID) {
      return res.status(200).json({ approvalUrl: null, formId, submissionId, reason: 'no workflow instance' });
    }

    const instUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?apiKey=${JOTFORM_API_KEY}&teamID=${TEAM_ID}`;
    const instRes = await fetch(instUrl);
    if (!instRes.ok) throw new Error(`Workflow instance API error: ${instRes.status}`);
    const instData = await instRes.json();
    const taskList: Array<Record<string, unknown>> = instData?.content?.taskList || [];

    const activeTask = taskList.find(t => String(t.status).toUpperCase() === 'ACTIVE');
    if (!activeTask) {
      return res.status(200).json({ approvalUrl: null, formId, submissionId, reason: 'no active task' });
    }

    // Extract formID and taskId
    const element = (activeTask.element || {}) as Record<string, unknown>;
    const props = (activeTask.properties || {}) as Record<string, unknown>;
    const taskFormID = element.internalFormID || element.resourceID || element.formID || props.formID;
    const taskId = String(activeTask.id || '');

    // Extract access token from accessLink (/share/ URL)
    const accessLink = String(
      activeTask.accessLink ||
      (props as any)?.accessLink ||
      (element as any)?.accessLink ||
      ''
    );
    const shareMatch = accessLink.match(/\/share\/(.+)$/);
    const accessToken = shareMatch ? shareMatch[1] : '';

    const taskType = String(element.type || '');

    if (taskType === 'workflow_assign_form') {
      // Check if prefill is enabled and fetch the prefill token from JotForm API
      const prefillEnabled = String((element as any).prefillEnabled || '') === 'Yes';
      if (prefillEnabled && taskFormID) {
        try {
          const prefillUrl = `${JOTFORM_BASE}/form/${taskFormID}/prefills?apiKey=${JOTFORM_API_KEY}&teamID=${TEAM_ID}`;
          const prefillRes = await fetch(prefillUrl);
          if (prefillRes.ok) {
            const prefillData = await prefillRes.json();
            const prefills = prefillData?.content || [];
            for (const p of prefills) {
              const urls: Array<Record<string, any>> = p.urls || [];
              const match = urls.find((u) => u.settings?.id === submissionId);
              if (match) {
                const constructedUrl = `${JOTFORM_HOST}/${taskFormID}/prefill/${match.id}?workflowAssignFormTask=1&taskID=${taskId}`;
                return res.status(200).json({ approvalUrl: constructedUrl, formId, submissionId, source: 'prefill-api' });
              }
            }
          }
        } catch (e) {
          console.error('Prefill API error:', e);
        }
      }
      // Fallback: no prefill or prefill not found
      const constructedUrl = `${JOTFORM_HOST}/${taskFormID}?workflowAssignFormTask=1&taskID=${taskId}`;
      return res.status(200).json({ approvalUrl: constructedUrl, formId, submissionId, source: 'constructed-form' });
    } else {
      // Approval / assigned-task types: JotForm's email notification uses the
      // /share/{token} URL directly — that's what actually works. The
      // /approval-form/{formID}/task/{taskID}/access-token/{token} rewrite
      // 404s for workflow_assign_task, so prefer the raw accessLink first.
      if (accessLink) {
        return res.status(200).json({ approvalUrl: accessLink, formId, submissionId, source: 'accessLink' });
      }

      // Last resort: path-based URL (works for some workflow_approval cases).
      if (taskFormID && taskId && accessToken) {
        const encodedToken = encodeURIComponent(accessToken);
        const constructedUrl = `${JOTFORM_HOST}/approval-form/${taskFormID}/task/${taskId}/access-token/${encodedToken}`;
        return res.status(200).json({ approvalUrl: constructedUrl, formId, submissionId, source: 'constructed-path' });
      }
    }

    return res.status(200).json({ approvalUrl: null, formId, submissionId, reason: 'no accessLink or token available' });
  } catch (err) {
    console.error('email-url error:', err);
    return res.status(200).json({ approvalUrl: null, formId, submissionId, error: String(err) });
  }
}
