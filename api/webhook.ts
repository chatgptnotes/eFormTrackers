import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { detectLevelFields, type DetectedLevelFields } from './detect-fields';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
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
    const url = `${JOTFORM_BASE}/submission/${submissionId}?apiKey=${API_KEY}`;
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
    try {
      const wfRes = await fetch(
        `${JOTFORM_BASE}/workflow/submission/${submissionId}/tasks?apiKey=${API_KEY}&teamID=${TEAM_ID}`
      );
      if (wfRes.ok) {
        const wfData = await wfRes.json();
        const rawTasks = Array.isArray(wfData.content) ? wfData.content : [];
        workflowTasks = rawTasks;
        // Find the pending task to get the current approver
        const pendingTask = rawTasks.find(
          (t: Record<string, unknown>) => String(t.status || '').toLowerCase() === 'pending'
        );
        if (pendingTask) {
          pendingApproverName = String(
            (pendingTask as Record<string, unknown>).assignee_name ||
            (pendingTask as Record<string, unknown>).assigneeName ||
            (pendingTask as Record<string, unknown>).name || ''
          );
          pendingApproverEmail = String(
            (pendingTask as Record<string, unknown>).assignee_email ||
            (pendingTask as Record<string, unknown>).assigneeEmail ||
            (pendingTask as Record<string, unknown>).email || ''
          );
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
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await supabase
      .from('jf_submissions')
      .upsert(record, { onConflict: 'jotform_submission_id' });

    if (error) throw new Error(error.message);

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
