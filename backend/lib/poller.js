const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch } = require('./jotform');
const { detectLevelFields } = require('./detect-fields');
const { emitToAll } = require('./realtime');

let isRunning = false;
let pollTimer = null;

// ── Text extractor (mirrors webhook handler) ──────────────────────────────────
function extractText(answer) {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    if (answer.first !== undefined || answer.last !== undefined)
      return [answer.first, answer.last].filter(Boolean).join(' ');
    if (answer.year && answer.month && answer.day)
      return `${answer.year}-${String(answer.month).padStart(2, '0')}-${String(answer.day).padStart(2, '0')}`;
    return Object.values(answer).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

// ── Build approval URL from active task ──────────────────────────────────────
function buildApprovalUrl(activeTask) {
  const element = activeTask.element || {};
  const props = activeTask.properties || {};
  const taskType = String(element.type || '');
  const taskId = String(activeTask.id || '');
  const internalFormID = element.internalFormID || element.resourceID || element.formID || props.formID;

  if (taskType === 'workflow_assign_form') {
    return internalFormID ? `${env.JOTFORM_HOST}/${internalFormID}?workflowAssignFormTask=1&taskID=${taskId}` : '';
  }

  const rawAccessLink = String(activeTask.accessLink || props.accessLink || '');
  const shareMatch = rawAccessLink.match(/\/share\/(.+)$/);
  const accessToken = shareMatch ? shareMatch[1] : '';
  if (internalFormID && taskId && accessToken) {
    return `${env.JOTFORM_HOST}/approval-form/${internalFormID}/task/${taskId}/access-token/${encodeURIComponent(accessToken)}`;
  }
  return rawAccessLink || '';
}

// ── Process one submission and upsert to DB ───────────────────────────────────
async function processSubmission(raw, formId, formTitle) {
  const submissionId = String(raw.id || '');
  if (!submissionId || !/^\d+$/.test(submissionId)) return;

  const answers = raw.answers || {};
  const get = (id) => id ? extractText(answers[id]?.answer) : '';

  // Detect form fields from questions cache (fetched once per form per poll)
  // We pass pre-detected fields, fetched outside this function
  return { submissionId, raw, answers, get, formId, formTitle };
}

// ── Fetch workflow instance info for a pending submission ─────────────────────
async function enrichWithWorkflow(submissionId, workflowInstanceId) {
  try {
    const instData = await jotformFetch(`workflow/instance/${workflowInstanceId}`);
    const taskList = instData?.content?.taskList || [];

    const activeTask = taskList.find(t => String(t.status || '').toUpperCase() === 'ACTIVE');
    if (!activeTask) return { pendingApproverName: '', pendingApproverEmail: '', approvalUrl: '', workflowTasks: taskList };

    const props = activeTask.properties || {};
    const assigneeUser = props.assigneeUser || {};
    const recipients = Array.isArray(props.recipients) ? props.recipients : [];
    const firstRecipient = recipients[0] || {};

    const pendingApproverName = String(assigneeUser.name || firstRecipient.name || '');
    const candidateEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || '');
    const pendingApproverEmail = candidateEmail.includes('@') ? candidateEmail : '';
    const approvalUrl = buildApprovalUrl(activeTask);

    return { pendingApproverName, pendingApproverEmail, approvalUrl, workflowTasks: taskList };
  } catch {
    return { pendingApproverName: '', pendingApproverEmail: '', approvalUrl: '', workflowTasks: [] };
  }
}

// ── Fetch fallback approver from jf_approver_config ──────────────────────────
async function getFallbackApprover(formId, level) {
  try {
    const { rows } = await pool.query(
      'SELECT approver_name, approver_email FROM jf_approver_config WHERE form_id = $1 AND level = $2',
      [formId, level]
    );
    if (rows[0]) return { name: rows[0].approver_name || '', email: rows[0].approver_email || '' };
  } catch { /* ignore */ }
  return { name: '', email: '' };
}

// ── Main poll cycle ───────────────────────────────────────────────────────────
async function pollOnce() {
  if (isRunning) {
    console.log('[poller] Previous poll still running — skipping');
    return;
  }
  isRunning = true;
  const start = Date.now();
  console.log('[poller] Poll started');

  try {
    // 1. Fetch all enabled forms
    const formsData = await jotformFetch('user/forms', { params: { limit: '1000', status: 'ENABLED' } });
    const forms = (formsData.content || []).filter(f => f.id);

    if (forms.length === 0) {
      console.log('[poller] No forms found');
      return;
    }

    // 2. Upsert form metadata into jf_forms (form creator via username field)
    for (const form of forms) {
      await pool.query(
        `INSERT INTO jf_forms (form_id, title, creator_username, status, created_at_jf, updated_at_jf, last_synced)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (form_id) DO UPDATE SET
           title=$2, creator_username=$3, status=$4, updated_at_jf=$6, last_synced=now()`,
        [
          String(form.id),
          String(form.title || ''),
          String(form.username || ''),
          String(form.status || ''),
          form.created_at ? new Date(form.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
          form.updated_at ? new Date(form.updated_at.replace(' ', 'T') + 'Z').toISOString() : null,
        ]
      ).catch(err => console.warn(`[poller] jf_forms upsert failed for ${form.id}:`, err.message));
    }

    let totalUpserted = 0;

    // 3. Process each form's submissions
    for (const form of forms) {
      const formId = String(form.id);
      const formTitle = String(form.title || '');

      // Fetch questions for field detection
      let detectedFields = null;
      try {
        const qData = await jotformFetch(`form/${formId}/questions`);
        detectedFields = detectLevelFields(qData.content || {});
      } catch (err) {
        console.warn(`[poller] Could not fetch questions for form ${formId}:`, err.message);
        continue;
      }

      // Fetch all submissions (up to 2000)
      let submissions = [];
      try {
        const subData = await jotformFetch(`form/${formId}/submissions`, {
          params: { limit: '1000', offset: '0', orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
        });
        submissions = subData.content || [];

        // Fetch second page if full
        if (submissions.length === 1000) {
          const subData2 = await jotformFetch(`form/${formId}/submissions`, {
            params: { limit: '1000', offset: '1000', orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
          });
          submissions = submissions.concat(subData2.content || []);
        }
      } catch (err) {
        console.warn(`[poller] Could not fetch submissions for form ${formId}:`, err.message);
        continue;
      }

      // 4. Process and upsert each submission
      for (const raw of submissions) {
        const submissionId = String(raw.id || '');
        if (!submissionId || !/^\d+$/.test(submissionId)) continue;

        try {
          const answers = raw.answers || {};
          const get = (id) => id ? extractText(answers[id]?.answer) : '';

          const levels = detectedFields.levelFields.map(lf => ({
            id: lf.level,
            status: get(lf.statusFieldId),
            approver: get(lf.approverFieldId),
            date: get(lf.dateFieldId),
          }));

          if (levels.length === 0 && detectedFields.overallStatusFieldId) {
            levels.push({ id: 1, status: get(detectedFields.overallStatusFieldId), approver: '', date: '' });
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

          const submittedBy = get(detectedFields.nameFieldId);
          const email = get(detectedFields.emailFieldId);
          const title = get(detectedFields.descFieldId) || `Form ${formId}`;
          const description = get(detectedFields.descFieldId) || '';
          const department = get(detectedFields.deptFieldId) || 'General';
          const priority = get(detectedFields.priorityFieldId) || 'medium';
          const amount = get(detectedFields.amountFieldId) || '';
          const editLink = String(raw.edit_link || '');

          const createdAt = raw.created_at || '';
          const updatedAt = raw.updated_at || '';
          const submissionDate = createdAt ? new Date(createdAt.replace(' ', 'T') + 'Z') : new Date();
          const updatedDate = updatedAt ? new Date(updatedAt.replace(' ', 'T') + 'Z') : null;
          const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

          const allAnswers = {};
          for (const [qid, q] of Object.entries(answers)) {
            const val = extractText(q.answer);
            if (val) allAnswers[qid] = val;
          }

          // 5. Enrich with workflow instance data for ALL pending submissions
          let pendingApproverName = '';
          let pendingApproverEmail = '';
          let workflowTasks = [];
          let approvalUrl = '';

          const workflowInstanceId = raw.workflowInstanceID || raw.workflow_instance_id;
          if (workflowInstanceId && status === 'pending') {
            const enriched = await enrichWithWorkflow(submissionId, workflowInstanceId);
            pendingApproverName = enriched.pendingApproverName;
            pendingApproverEmail = enriched.pendingApproverEmail;
            approvalUrl = enriched.approvalUrl;
            workflowTasks = enriched.workflowTasks;
          }

          // Fallback: jf_approver_config if workflow gave us nothing
          if (!pendingApproverEmail && status === 'pending') {
            const fallback = await getFallbackApprover(formId, currentLevel);
            pendingApproverName = fallback.name;
            pendingApproverEmail = fallback.email;
          }

          const levelHistory = levels.map(l => ({
            level: l.id, status: l.status || 'pending',
            approver: l.approver || pendingApproverName || '', date: l.date || '',
          }));

          const genericStatus = status === 'completed' ? 'Completed' :
            status === 'rejected' ? 'Rejected' :
            levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

          await pool.query(
            `INSERT INTO jf_submissions (
              jotform_submission_id, form_id, form_title, title, description,
              submitted_by, submitter_name, submitter_email, department,
              submission_date, current_level, status, priority, amount,
              approver_name, approver_email, pending_approver_name, pending_approver_email,
              jotform_status, answers, workflow_tasks, level_history, edit_link,
              raw_data, created_at_jf, updated_at_jf, days_at_level, total_days,
              last_synced, needs_sync, approval_url
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now(),$29,$30)
            ON CONFLICT (jotform_submission_id) DO UPDATE SET
              form_id=$2, form_title=$3, title=$4, description=$5,
              submitted_by=$6, submitter_name=$7, submitter_email=$8, department=$9,
              submission_date=$10, current_level=$11, status=$12, priority=$13, amount=$14,
              approver_name=$15, approver_email=$16, pending_approver_name=$17, pending_approver_email=$18,
              jotform_status=$19, answers=$20, workflow_tasks=$21, level_history=$22, edit_link=$23,
              raw_data=$24, created_at_jf=$25, updated_at_jf=$26, days_at_level=$27, total_days=$28,
              last_synced=now(), needs_sync=$29, approval_url=$30`,
            [
              submissionId, formId, formTitle, title, description,
              submittedBy, submittedBy, email, department,
              submissionDate.toISOString(), Math.min(currentLevel, maxLevel), status, priority, amount,
              pendingApproverName || levels.find(l => l.approver)?.approver || '',
              pendingApproverEmail,
              pendingApproverName, pendingApproverEmail,
              genericStatus,
              JSON.stringify(allAnswers), JSON.stringify(workflowTasks),
              JSON.stringify(levelHistory), editLink,
              JSON.stringify({ ...raw, _mapped: { levels, email, amount } }),
              submissionDate.toISOString(), updatedDate?.toISOString() || null,
              totalDays, totalDays,
              false, approvalUrl || null,
            ]
          );
          totalUpserted++;
        } catch (err) {
          console.warn(`[poller] Failed to process submission ${submissionId}:`, err.message);
        }
      }
    }

    // 6. Broadcast to all connected frontend clients
    emitToAll('submissions:updated', { polledAt: new Date().toISOString(), count: totalUpserted });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[poller] Poll complete — ${totalUpserted} submissions upserted in ${elapsed}s`);
  } catch (err) {
    console.error('[poller] Poll failed:', err.message);
  } finally {
    isRunning = false;
  }
}

// ── Start the poller ──────────────────────────────────────────────────────────
function startPoller() {
  const intervalMs = (env.POLL_INTERVAL_MINUTES || 2) * 60 * 1000;
  console.log(`[poller] Starting — polling every ${env.POLL_INTERVAL_MINUTES || 2} minutes`);

  // Run immediately on startup
  pollOnce().catch(err => console.error('[poller] Initial poll error:', err.message));

  // Then on interval
  pollTimer = setInterval(() => {
    pollOnce().catch(err => console.error('[poller] Interval poll error:', err.message));
  }, intervalMs);
}

function stopPoller() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

module.exports = { startPoller, stopPoller, pollOnce };
