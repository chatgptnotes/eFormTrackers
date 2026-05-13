import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertNotification(supabaseClient: any, params: {
  userEmail: string; type: string; title: string; message: string;
  submissionId?: string; formId?: string; data?: Record<string, unknown>;
}) {
  const { error } = await supabaseClient.from('notifications').insert({
    user_email: params.userEmail, type: params.type, title: params.title,
    message: params.message, submission_id: params.submissionId || null,
    form_id: params.formId || null, data: params.data || {},
  });
  if (error) console.warn('[JotFlow] Notification insert error:', error.message);
}

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/workflow-action
 *
 * Approves, rejects, or completes a JotForm workflow task directly
 * via the workflow engine API.
 *
 * Body: { submissionId, action: "approve" | "reject" | "complete", comment? }
 *
 * Flow:
 * 1. Get workflowInstanceID from submission
 * 2. Get taskList from workflow instance
 * 3. Find the ACTIVE task
 * 4. Read its outcomes to determine correct outcomeID
 * 5. POST /workflow/task/{taskId}/complete with outcomeID
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
  }

  const { submissionId, action, comment, signature } = req.body || {};
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });
  if (!action || !['approve', 'reject', 'complete'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve", "reject", or "complete"' });
  }

  try {
    // Step 1: Get workflowInstanceID
    const subUrl = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
    const subRes = await fetch(subUrl);
    if (!subRes.ok) throw new Error(`Submission API error: ${subRes.status}`);
    const subData = await subRes.json();
    const content = subData?.content || subData;
    const instanceId = content?.workflowInstanceID || content?.workflow_instance_id;

    if (!instanceId) {
      return res.status(404).json({ error: 'No workflow instance found for this submission' });
    }

    // Step 2: Get workflow instance taskList
    const instUrl = `${JOTFORM_BASE}/workflow/instance/${instanceId}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const instRes = await fetch(instUrl);
    if (!instRes.ok) throw new Error(`Workflow instance API error: ${instRes.status}`);
    const instData = await instRes.json();
    const taskList: Array<Record<string, unknown>> = instData?.content?.taskList || [];

    // Step 3: Find the ACTIVE task
    const activeTask = taskList.find(t => t.status === 'ACTIVE');
    if (!activeTask) {
      return res.status(400).json({ error: 'No active task found — workflow may already be completed' });
    }

    const taskId = activeTask.id;
    const element = (activeTask.element || {}) as Record<string, unknown>;
    const taskType = String(element.type || '');
    const taskName = String(element.name || '');
    const outcomes = Array.isArray(element.outcomes) ? element.outcomes : [];

    // Step 4: Determine the correct outcomeID
    let outcomeID: number | undefined;

    if (action === 'approve') {
      // For approval tasks: find APPROVE outcome
      const approveOutcome = outcomes.find((o: Record<string, unknown>) =>
        String(o.type).toUpperCase() === 'APPROVE'
      );
      if (approveOutcome) {
        outcomeID = Number(approveOutcome.outcomeID);
      } else {
        // Fallback: use first outcome (usually "Complete" for task/form types)
        outcomeID = outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1;
      }
    } else if (action === 'reject') {
      // For approval tasks: find DENY outcome
      const denyOutcome = outcomes.find((o: Record<string, unknown>) =>
        String(o.type).toUpperCase() === 'DENY'
      );
      if (denyOutcome) {
        outcomeID = Number(denyOutcome.outcomeID);
      } else {
        return res.status(400).json({
          error: `This workflow step ("${taskName}") does not support rejection — it's a ${taskType} step`,
        });
      }
    } else {
      // "complete" — use first outcome
      outcomeID = outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1;
    }

    // Step 5: Complete the task via workflow API
    const completeUrl = `${JOTFORM_BASE}/workflow/task/${taskId}/complete?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
    const body: Record<string, unknown> = { outcomeID };
    if (comment) body.comment = comment;
    // For "Approve & Sign" steps, JotForm requires a signature
    if (signature) body.signature = signature;

    const completeRes = await fetch(completeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      throw new Error(`Workflow task complete failed: ${completeRes.status} — ${errText}`);
    }

    const result = await completeRes.json();

    // Save approval to jf_approval_history for audit trail and comment retrieval
    try {
      const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
      const taskProps = (activeTask.properties || {}) as Record<string, unknown>;
      const assigneeUser = (taskProps.assigneeUser || {}) as Record<string, unknown>;
      const approverLevel = Number(activeTask.level || 0);
      const approverName = String(assigneeUser.name || '');
      const approverEmail = String(assigneeUser.email || '');

      const { error: histError } = await supa.from('jf_approval_history').insert({
        submission_id: submissionId,
        form_id: content?.formID || '', // Get from submission
        level: approverLevel,
        action: action.toUpperCase(),
        approver_name: approverName,
        approver_email: approverEmail,
        comment: comment || '',
      });
      if (histError) {
        console.warn('[JotFlow] jf_approval_history insert error:', histError.message);
      }
    } catch (histErr) {
      console.warn('[JotFlow] jf_approval_history save failed:', histErr);
    }

    // Send notifications to the submitter on final approval or rejection
    try {
      const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: subRow } = await supa.from('jf_submissions')
        .select('submitter_email, title, form_title')
        .eq('jotform_submission_id', submissionId)
        .single();
      const submitterEmail = subRow?.submitter_email || '';
      const submissionTitle = subRow?.title || subRow?.form_title || 'Request';

      if (action === 'approve' && submitterEmail) {
        const isFinal = result?.content?.instanceCompleted || false;
        await insertNotification(supa, {
          userEmail: submitterEmail,
          type: 'submission',
          title: isFinal ? 'Request fully approved' : 'Request approved at current level',
          message: isFinal
            ? `Your request "${submissionTitle}" has been fully approved`
            : `Your request "${submissionTitle}" was approved and moved to the next level`,
          submissionId,
          data: { action: 'approved', final: isFinal },
        }).catch(err => console.warn('[JotFlow] Notification failed:', err));

        // Notify the NEXT approver if workflow moved to a new task
        if (!isFinal) {
          try {
            // Re-fetch workflow instance to find the newly ACTIVE task
            const updatedInstRes = await fetch(
              `${JOTFORM_BASE}/workflow/instance/${instanceId}?apiKey=${API_KEY}&teamID=${TEAM_ID}`
            );
            if (updatedInstRes.ok) {
              const updatedInstData = await updatedInstRes.json();
              const updatedTaskList: Array<Record<string, unknown>> = updatedInstData?.content?.taskList || [];
              const nextActiveTask = updatedTaskList.find(t => t.status === 'ACTIVE');
              if (nextActiveTask) {
                const props = (nextActiveTask.properties || {}) as Record<string, unknown>;
                const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
                const recipients = Array.isArray(props.recipients) ? props.recipients : [];
                const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;
                // Only use fields that are actual email addresses (must contain @)
                const candidateEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || '');
                const nextApproverEmail = candidateEmail.includes('@') ? candidateEmail : '';
                const nextApproverName = String(assigneeUser.name || firstRecipient.name || '');

                if (nextApproverEmail) {
                  await insertNotification(supa, {
                    userEmail: nextApproverEmail,
                    type: 'approval_needed',
                    title: 'New approval request',
                    message: `"${submissionTitle}" needs your approval`,
                    submissionId,
                    data: { assignee: nextApproverName },
                  }).catch(err => console.warn('[JotFlow] Next-approver notification failed:', err));
                }
              }
            }
          } catch (nextErr) {
            console.warn('[JotFlow] Next-approver lookup failed:', nextErr);
          }
        }
      } else if (action === 'reject' && submitterEmail) {
        await insertNotification(supa, {
          userEmail: submitterEmail,
          type: 'submission',
          title: 'Request rejected',
          message: `Your request "${submissionTitle}" was rejected${comment ? ': ' + comment : ''}`,
          submissionId,
          data: { action: 'rejected', reason: comment || '' },
        }).catch(err => console.warn('[JotFlow] Notification failed:', err));
      }
    } catch (notifErr) {
      console.warn('[JotFlow] Notification logic failed:', notifErr);
    }

    return res.status(200).json({
      ok: true,
      action,
      taskId,
      taskName,
      taskType,
      outcomeID,
      instanceCompleted: result?.content?.instanceCompleted || false,
    });
  } catch (err) {
    console.error('workflow-action error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
