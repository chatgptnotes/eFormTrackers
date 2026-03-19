import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
// ── Inlined detect-fields (Vercel serverless can't resolve cross-dir imports) ──

interface LevelFieldGroup {
  level: number;
  statusFieldId: string;
  approverFieldId: string | null;
  dateFieldId: string | null;
}

interface DetectedLevelFields {
  overallStatusFieldId: string | null;
  evaluatorEmailsByLevel: Record<number, string>;
  levelFields: LevelFieldGroup[];
  nameFieldId: string | null;
  emailFieldId: string | null;
  descFieldId: string | null;
  deptFieldId: string | null;
  priorityFieldId: string | null;
  amountFieldId: string | null;
}

interface Question { qid?: string; text?: string; name?: string; type?: string; }

function detectLevelFields(questions: Record<string, Question>): DetectedLevelFields {
  const list = Object.entries(questions).map(([qid, q]) => ({ qid, ...q })).sort((a, b) => parseInt(a.qid) - parseInt(b.qid));
  let overallStatusFieldId: string | null = null;
  let nameFieldId: string | null = null;
  let emailFieldId: string | null = null;
  let descFieldId: string | null = null;
  let deptFieldId: string | null = null;
  let priorityFieldId: string | null = null;
  let amountFieldId: string | null = null;
  const evaluatorEmailsByLevel: Record<number, string> = {};
  const byLevel: Record<number, { s?: string; a?: string; d?: string }> = {};

  for (const q of list) {
    const raw = (q.text || q.name || '').trim();
    const lbl = raw.toLowerCase();
    const id = q.qid;
    if (!nameFieldId && (q.type === 'control_fullname' || lbl === 'name' || lbl.includes('full name') || lbl.includes('requester') || lbl.includes('submitted by') || lbl.includes('applicant') || lbl.includes('employee name'))) { nameFieldId = id; continue; }
    if (!emailFieldId && (q.type === 'control_email' || lbl.includes('email') || lbl.includes('e-mail'))) { emailFieldId = id; continue; }
    const levelEmailMatch = lbl.match(/^(?:l|level)\s*(\d+)\s+(?:evaluator|approver|reviewer)\s+email$/);
    if (levelEmailMatch) { evaluatorEmailsByLevel[parseInt(levelEmailMatch[1])] = id!; continue; }
    if (!deptFieldId && (lbl.includes('department') || lbl.includes('dept') || lbl.includes('division') || lbl.includes('section'))) { deptFieldId = id; continue; }
    if (!descFieldId && (lbl.includes('description') || lbl.includes('subject') || lbl.includes('purpose') || lbl.includes('request detail') || lbl.includes('justification') || lbl.includes('title') || (lbl.includes('detail') && !lbl.includes('date')))) { descFieldId = id; continue; }
    if (!priorityFieldId && lbl.includes('priority')) { priorityFieldId = id; continue; }
    if (!amountFieldId && (lbl.includes('amount') || lbl.includes('budget') || lbl.includes('cost') || lbl.includes('total') || lbl.includes('value') || lbl.includes('price'))) { amountFieldId = id; continue; }
    const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
    if (!overallStatusFieldId && !hasLevel && (lbl === 'status' || lbl === 'overall status' || lbl === 'final status' || lbl === 'approval status' || (lbl.includes('overall') && lbl.includes('status')))) { overallStatusFieldId = id; continue; }
    const lvlMatch = lbl.match(/(?:^|\b)(?:l|level|stage)\s*(\d+)(?:\b|$)/);
    if (lvlMatch) {
      const lvl = parseInt(lvlMatch[1]);
      if (!byLevel[lvl]) byLevel[lvl] = {};
      if (lbl.includes('status') || lbl.includes('decision') || lbl.includes('approval')) { if (!byLevel[lvl].s) byLevel[lvl].s = id; }
      else if (lbl.includes('approver') || lbl.includes('approved by') || lbl.includes('reviewer')) { if (!byLevel[lvl].a) byLevel[lvl].a = id; }
      else if (lbl.includes('date') || lbl.includes('time')) { if (!byLevel[lvl].d) byLevel[lvl].d = id; }
      else { if (!byLevel[lvl].s) byLevel[lvl].s = id; }
    }
    if (!overallStatusFieldId && !hasLevel && lbl.includes('approval') && lbl.includes('status')) { overallStatusFieldId = id; }
  }
  const levelFields: LevelFieldGroup[] = Object.entries(byLevel).filter(([, f]) => !!f.s).map(([lvl, f]) => ({ level: parseInt(lvl), statusFieldId: f.s!, approverFieldId: f.a || null, dateFieldId: f.d || null })).sort((a, b) => a.level - b.level);
  return { overallStatusFieldId, evaluatorEmailsByLevel, levelFields, nameFieldId, emailFieldId, descFieldId, deptFieldId, priorityFieldId, amountFieldId };
}
// ── End inlined detect-fields ──
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
const JOTFORM_HOST = 'https://eforms.mediaoffice.ae';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eekudqlzzklhyhwkqvme.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function extractText(answer: unknown): string {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, string>;
    if (obj.first !== undefined || obj.last !== undefined)
      return [obj.first, obj.last].filter(Boolean).join(' ');
    if (obj.year && obj.month && obj.day)
      return `${obj.year}-${String(obj.month).padStart(2,'0')}-${String(obj.day).padStart(2,'0')}`;
    return Object.values(obj).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

const WEBHOOK_SECRET = process.env.JOTFORM_WEBHOOK_SECRET || '';

// ── In-process cache for detected fields (keyed by formId, 1hr TTL) ──
const fieldCache: Record<string, { fields: DetectedLevelFields; at: number }> = {};
const FIELD_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getFieldsForForm(formId: string): Promise<DetectedLevelFields> {
  const cached = fieldCache[formId];
  if (cached && Date.now() - cached.at < FIELD_CACHE_TTL) {
    return cached.fields;
  }

  const qRes = await fetch(
    `${JOTFORM_BASE}/form/${formId}/questions?apiKey=${API_KEY}&teamID=${TEAM_ID}`
  );
  if (!qRes.ok) throw new Error(`Failed to fetch questions for form ${formId}: ${qRes.status}`);
  const qData = await qRes.json();
  const questions = qData.content || {};

  const fields = detectLevelFields(questions);
  fieldCache[formId] = { fields, at: Date.now() };
  return fields;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Webhooks are server-to-server — no CORS needed, restrict to POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate webhook secret if configured (query param ?secret=...)
  if (WEBHOOK_SECRET) {
    const secret = req.query.secret as string;
    if (secret !== WEBHOOK_SECRET) {
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  // JotForm sends a POST with rawRequest (URL-encoded JSON) or JSON body
  let submissionId: string | undefined;
  let formId: string | undefined;

  if (req.body) {
    const body = typeof req.body === 'string'
      ? Object.fromEntries(new URLSearchParams(req.body))
      : req.body;
    submissionId = body.submissionID || body.submissionId;
    formId = body.formID || body.formId;
  }

  if (!submissionId) {
    // No specific submission — nothing to do (legacy sync endpoint removed)
    return res.status(200).json({ ok: true, action: 'no-submission-id' });
  }

  try {
    // Fetch this specific submission from JotForm
    const url = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}&teamID=${TEAM_ID}&addWorkflowStatus=1`;
    const jfRes = await fetch(url);
    if (!jfRes.ok) throw new Error(`JotForm error: ${jfRes.status}`);
    const jfData = await jfRes.json();
    const raw = jfData.content as Record<string, unknown>;
    if (!raw) throw new Error('No content in JotForm response');

    // Use formId from webhook body, or from submission itself
    if (!formId) formId = String(raw.form_id || '');
    if (!formId) throw new Error('No formId found in webhook body or submission');

    const answers = (raw.answers as Record<string, { answer: unknown }>) || {};
    const get = (id: string | null | undefined) => id ? extractText(answers[id]?.answer) : '';

    // Dynamically detect fields for this form
    const detected = await getFieldsForForm(formId);

    // Build levels from detected fields
    const levels = detected.levelFields.map(lf => ({
      id: lf.level,
      status: get(lf.statusFieldId),
      approver: get(lf.approverFieldId),
      date: get(lf.dateFieldId),
    }));

    // If no level fields detected, try overall status field only
    if (levels.length === 0 && detected.overallStatusFieldId) {
      levels.push({
        id: 1,
        status: get(detected.overallStatusFieldId),
        approver: '',
        date: '',
      });
    }

    let currentLevel = 1;
    let status = 'pending';
    const maxLevel = levels.length || 1;

    for (const lvl of levels) {
      const s = (lvl.status || '').toLowerCase();
      if (s === 'approved') {
        currentLevel = lvl.id + 1;
        if (lvl.id === maxLevel) { currentLevel = maxLevel; status = 'completed'; }
      } else if (s === 'rejected') {
        currentLevel = lvl.id; status = 'rejected'; break;
      } else {
        currentLevel = lvl.id; status = 'pending'; break;
      }
    }

    // Read submitter info from detected fields
    const submittedBy = get(detected.nameFieldId);
    const email = get(detected.emailFieldId);
    const title = get(detected.descFieldId) || `Form ${formId}`;
    const description = get(detected.descFieldId) || '';
    const department = get(detected.deptFieldId) || 'General';
    const priority = get(detected.priorityFieldId) || 'medium';
    const amount = get(detected.amountFieldId) || '';
    const formTitle = String(raw.form_title || '') || `Form ${formId}`;
    const editLink = String(raw.edit_link || '');

    const createdAt = (raw.created_at as string) || '';
    const updatedAt = (raw.updated_at as string) || '';
    const submissionDate = createdAt ? new Date(createdAt.replace(' ', 'T') + 'Z') : new Date();
    const updatedDate = updatedAt ? new Date(updatedAt.replace(' ', 'T') + 'Z') : null;
    const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

    // Detect native JotForm approval: all hidden fields blank but submission was acted upon
    const allFieldsBlank = levels.every(l => !l.status);
    const rawCreatedAt = createdAt;
    const rawUpdatedAt = updatedAt;
    const acted = rawCreatedAt && rawUpdatedAt && rawCreatedAt !== rawUpdatedAt;
    const needsSync = (status === 'pending' && allFieldsBlank && acted) ? true : false;

    // Build ALL answers as a flat key-value JSONB object
    const allAnswers: Record<string, string> = {};
    for (const [qid, q] of Object.entries(answers)) {
      const val = extractText((q as { answer: unknown }).answer);
      if (val) allAnswers[qid] = val;
    }

    // Fetch workflow tasks to get real pending approver info
    let pendingApproverName = '';
    let pendingApproverEmail = '';
    let workflowTasks: unknown[] = [];
    let approvalUrl = '';
    try {
      const workflowInstanceID = raw.workflowInstanceID || raw.workflow_instance_id;
      if (workflowInstanceID) {
        const instUrl = `${JOTFORM_BASE}/workflow/instance/${workflowInstanceID}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
        const instRes = await fetch(instUrl);
        if (instRes.ok) {
          const instData = await instRes.json();
          const taskList = instData?.content?.taskList || [];
          workflowTasks = taskList;

          // Find ACTIVE task (same field extraction as workflow-tasks.ts)
          const activeTask = taskList.find((t: any) =>
            String(t.status || '').toUpperCase() === 'ACTIVE'
          );
          if (activeTask) {
            const props = (activeTask.properties || {}) as Record<string, unknown>;
            const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
            const recipients = Array.isArray(props.recipients) ? props.recipients : [];
            const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;

            pendingApproverName = String(assigneeUser.name || firstRecipient.name || '');
            const candidateEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || '');
            pendingApproverEmail = candidateEmail.includes('@') ? candidateEmail : '';

            // Construct direct approval URL from ACTIVE task
            const element = (activeTask.element || {}) as Record<string, unknown>;
            const wProps = (activeTask.properties || {}) as Record<string, unknown>;
            const internalFormID = element.internalFormID || element.resourceID || element.formID || wProps.formID;
            const taskType = String(element.type || '');
            const taskId = String(activeTask.id || '');
            if (internalFormID && taskId) {
              let queryParam = 'workflowApprovalTask';
              if (taskType === 'workflow_assign_form') queryParam = 'workflowAssignFormTask';
              else if (taskType === 'workflow_assign_task') queryParam = 'workflowAssignTask';
              approvalUrl = `${JOTFORM_HOST}/${internalFormID}?${queryParam}=1&taskID=${taskId}`;
            }
          }
        }
      }
    } catch (wfErr) {
      console.warn('Could not fetch workflow tasks:', wfErr);
    }

    // Build level history
    const levelHistory = levels.map(l => ({
      level: l.id,
      status: l.status || 'pending',
      approver: l.approver || pendingApproverName || '',
      date: l.date || '',
    }));

    // Determine generic status label
    const genericStatus = status === 'completed' ? 'Completed' :
      status === 'rejected' ? 'Rejected' :
      levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

    const record = {
      jotform_submission_id: submissionId,
      form_id: formId,
      form_title: formTitle,
      title,
      description,
      submitted_by: submittedBy,
      submitter_name: submittedBy,
      submitter_email: email,
      department,
      submission_date: submissionDate.toISOString(),
      current_level: Math.min(currentLevel, maxLevel),
      status,
      priority,
      amount,
      approver_name: pendingApproverName || levels.find(l => l.approver)?.approver || '',
      approver_email: pendingApproverEmail,
      pending_approver_name: pendingApproverName,
      pending_approver_email: pendingApproverEmail,
      jotform_status: genericStatus,
      answers: allAnswers,
      workflow_tasks: workflowTasks,
      level_history: levelHistory,
      edit_link: editLink,
      raw_data: { ...raw, _mapped: { levels, email, amount } },
      created_at_jf: submissionDate.toISOString(),
      updated_at_jf: updatedDate?.toISOString() || null,
      days_at_level: totalDays,
      total_days: totalDays,
      last_synced: new Date().toISOString(),
      needs_sync: needsSync,
      approval_url: approvalUrl || null,
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await supabase
      .from('jf_submissions')
      .upsert(record, { onConflict: 'jotform_submission_id' });

    if (error) throw new Error(error.message);

    // Notify the pending approver (if known)
    if (pendingApproverEmail && status === 'pending') {
      await insertNotification(supabase, {
        userEmail: pendingApproverEmail,
        type: 'approval_needed',
        title: 'New approval request',
        message: `${title} from ${submittedBy || 'Unknown'} (${department}) needs your approval`,
        submissionId,
        formId,
        data: { level: currentLevel, submittedBy, department },
      }).catch(err => console.warn('[JotFlow] Notification insert failed:', err));
    }

    // Upsert approval history rows for each level that has been actioned
    for (const lvl of levels) {
      if (lvl.status) {
        const action = lvl.status.toLowerCase().includes('approved') ? 'approved'
          : lvl.status.toLowerCase().includes('rejected') ? 'rejected'
          : 'pending';
        await supabase
          .from('jf_approval_history')
          .upsert({
            submission_id: submissionId,
            form_id: formId,
            level: lvl.id,
            action,
            approver_name: lvl.approver || pendingApproverName || '',
            approver_email: pendingApproverEmail || '',
            actioned_at: lvl.date ? new Date(lvl.date).toISOString() : new Date().toISOString(),
          }, { onConflict: 'idx_jf_approval_history_sub_level' })
          .then(() => {}); // best-effort, don't block response
      }
    }

    return res.status(200).json({ ok: true, submissionId, currentLevel, status, pendingApproverName, pendingApproverEmail });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
