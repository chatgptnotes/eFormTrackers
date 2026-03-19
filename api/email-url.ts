import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const JOTFORM_BASE = process.env.JOTFORM_BASE || 'https://eforms.mediaoffice.ae/API';
const JOTFORM_HOST = process.env.JOTFORM_HOST || 'https://eforms.mediaoffice.ae';
const JOTFORM_API_KEY = process.env.JOTFORM_API_KEY || '';
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * GET /api/email-url?formId={id}&submissionId={id}
 *
 * Returns the direct approval/form URL.
 * 1. Check Supabase for a stored approval_url
 * 2. Fallback: fetch workflow instance and construct the URL
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
    // ── Strategy 1: Read stored URL from Supabase ──
    if (SUPABASE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data } = await supabase
        .from('jf_submissions')
        .select('approval_url')
        .eq('jotform_submission_id', submissionId)
        .single();

      if (data?.approval_url) {
        return res.status(200).json({
          approvalUrl: data.approval_url,
          formId,
          submissionId,
          source: 'database',
        });
      }
    }

    // ── Strategy 2: Construct from workflow instance ──
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

    const taskId = String(activeTask.id);
    const element = (activeTask.element || {}) as Record<string, unknown>;
    const internalFormID = element.internalFormID || element.resourceID;
    const taskType = String(element.type || '');

    if (!internalFormID) {
      return res.status(200).json({ approvalUrl: null, formId, submissionId, reason: 'no internalFormID' });
    }

    let queryParam = 'workflowApprovalTask';
    if (taskType === 'workflow_assign_form') queryParam = 'workflowAssignFormTask';
    else if (taskType === 'workflow_assign_task') queryParam = 'workflowAssignTask';

    const approvalUrl = `${JOTFORM_HOST}/${internalFormID}?${queryParam}=1&taskID=${taskId}`;

    // Store it in Supabase for next time
    if (SUPABASE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      await supabase
        .from('jf_submissions')
        .update({ approval_url: approvalUrl })
        .eq('jotform_submission_id', submissionId)
        .then(() => {}); // best-effort
    }

    return res.status(200).json({
      approvalUrl,
      formId,
      submissionId,
      taskId,
      taskType,
      source: 'constructed',
    });
  } catch (err) {
    console.error('email-url error:', err);
    return res.status(200).json({ approvalUrl: null, formId, submissionId, error: String(err) });
  }
}
