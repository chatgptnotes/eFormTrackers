const { Router } = require('express');
const pool = require('../db/pool');
const { jotformFetch } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { pMapLimit } = require('../lib/concurrency');
const { requireAuth, requireRole } = require('../middleware/auth');
const { detectLevelFields } = require('../lib/detect-fields');
const { extractTask, deriveWorkflowStatus, mergeWorkflowTasksSql } = require('../lib/workflow-task');
const { upsertEmailLogs } = require('../lib/email-log');

const router = Router();

const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_FORM = 50;
const FORM_CONCURRENCY = 3;
const UPSERT_CHUNK = 50;

function parseEmailFromActionText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/By:\s*[^(]*\(([^)]+@[^)]+)\)/);
  return m ? m[1].trim() : '';
}

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

// Returns { rows, truncated }. `truncated` is true only when we hit the
// MAX_PAGES_PER_FORM cap while JotForm was still returning full pages — so a
// form larger than the cap never gets silently dropped without a signal.
async function fetchAllSubmissionsForForm(formId, keyType, log) {
  const all = [];
  let offset = 0;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES_PER_FORM; page++) {
    let data;
    try {
      data = await jotformFetch(`form/${formId}/submissions`, {
        params: { limit: PAGE_LIMIT, offset, orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
        keyType,
      });
    } catch (e) {
      log.warn({ formId, offset, err: e.message }, '[admin-sync] page fetch failed');
      break;
    }
    const page_rows = Array.isArray(data?.content) ? data.content : [];
    all.push(...page_rows);
    if (page_rows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    // Last allowed page still returned a full page → more data remains.
    if (page === MAX_PAGES_PER_FORM - 1) {
      truncated = true;
      log.warn({ formId, fetched: all.length }, '[admin-sync] form truncated at MAX_PAGES_PER_FORM');
    }
  }
  return { rows: all, truncated };
}

// Fetch the workflow-instance for a submission and return:
//   { status: 'completed'|'rejected'|'pending'|null, taskList: [...] }
// Returns null status when no workflowInstanceID is on the raw submission.
async function fetchWorkflowInstance(raw, keyType, log) {
  const instanceId = raw.workflowInstanceID || raw.workflow_instance_id;
  if (!instanceId) return { status: null, taskList: [] };
  try {
    const data = await jotformFetch(`workflow/instance/${instanceId}`, { keyType });
    const content = data?.content || {};
    const wfStatus = String(content.status || '').toUpperCase();
    const rawTasks = Array.isArray(content.taskList) ? content.taskList : [];
    // Flatten raw JotForm tasks to the shape WorkflowDetailsSidebar expects.
    // Level derives from 1-based taskList order when properties.level is absent.
    const taskList = rawTasks.map((t, idx) => extractTask(t, idx + 1));
    // Authoritative status from instance status + task list (end node / all-done).
    const status = deriveWorkflowStatus(wfStatus, taskList);
    return { status, taskList };
  } catch (e) {
    log.warn({ instanceId, err: e.message }, '[admin-sync] workflow instance fetch failed');
    return { status: null, taskList: [] };
  }
}

function mapRawToUpsertParams(raw, formId, formTitle, fields, wfStatusOverride, wfTaskList) {
  const answers = raw.answers || {};
  const get = (id) => id ? extractText(answers[id]?.answer) : '';

  const levels = fields.levelFields.map(lf => ({
    id: lf.level,
    status: get(lf.statusFieldId),
    approver: get(lf.approverFieldId),
    date: get(lf.dateFieldId),
  }));
  if (levels.length === 0 && fields.overallStatusFieldId) {
    levels.push({ id: 1, status: get(fields.overallStatusFieldId), approver: '', date: '' });
  }

  let currentLevel = 1;
  let status = 'pending';
  const maxLevel = levels.length || 1;
  for (const lvl of levels) {
    const s = (lvl.status || '').toLowerCase();
    if (s.includes('approved') || s.includes('completed')) {
      if (lvl.id === maxLevel) { currentLevel = maxLevel; status = 'completed'; break; }
      currentLevel = lvl.id + 1;
    } else if (s.includes('rejected')) {
      currentLevel = lvl.id; status = 'rejected'; break;
    } else {
      currentLevel = lvl.id; status = 'pending'; break;
    }
  }

  // Authoritative override: the workflow-instance status is the source of truth.
  // The level-field heuristic above is just a fallback for forms without a
  // workflow instance attached.
  if (wfStatusOverride) {
    status = wfStatusOverride;
    if (wfStatusOverride === 'completed') currentLevel = maxLevel;
  }

  const submittedBy = get(fields.nameFieldId);
  const email = get(fields.emailFieldId);
  const title = get(fields.descFieldId) || `Form ${formId}`;
  const description = get(fields.descFieldId) || '';
  const department = get(fields.deptFieldId) || 'General';
  const priority = get(fields.priorityFieldId) || 'medium';
  const amount = get(fields.amountFieldId) || '';

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

  const levelHistory = levels.map(l => {
    // Use wfTaskList to enrich approverEmail: completed tasks have submittedByEmail
    // (who actually clicked approve); pending/active tasks have assigneeEmail.
    const matchingTask = (wfTaskList || []).find(t => t.level === l.id);
    const approverEmail = parseEmailFromActionText(l.approver) ||
      (matchingTask
        ? (String(matchingTask.status || '').toUpperCase() === 'COMPLETED'
            ? (matchingTask.submittedByEmail || matchingTask.assigneeEmail)
            : matchingTask.assigneeEmail)
        : '');
    return {
      level: l.id, status: l.status || 'pending',
      approver: l.approver || '',
      approverEmail: approverEmail || '',
      date: l.date || '',
    };
  });

  const genericStatus = status === 'completed' ? 'Completed' :
    status === 'rejected' ? 'Rejected' :
    levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

  // "Pending With" = the currently ACTIVE workflow task's assignee. This is the
  // authoritative answer to "where is it pending" and also drives visibility for
  // the assigned user (visibility.js / isSubmissionVisible match this email).
  const activeTask = (wfTaskList || []).find(t => String(t.status || '').toUpperCase() === 'ACTIVE');
  const pendingApproverName = activeTask?.assigneeName || '';
  const pendingApproverEmail = activeTask?.assigneeEmail || '';

  return [
    String(raw.id), formId, formTitle, title, description,
    submittedBy, submittedBy, email, department,
    submissionDate.toISOString(), Math.min(currentLevel, maxLevel), status, priority, amount,
    levels.find(l => l.approver)?.approver || pendingApproverName, pendingApproverEmail,
    pendingApproverName, pendingApproverEmail,
    genericStatus,
    JSON.stringify(allAnswers), JSON.stringify(wfTaskList || []),
    JSON.stringify(levelHistory), String(raw.edit_link || ''),
    JSON.stringify({ ...raw, _mapped: { levels, email, amount } }),
    submissionDate.toISOString(), updatedDate?.toISOString() || null,
    totalDays, totalDays,
    false, null,
  ];
}

async function fetchFieldsForForm(formId, keyType, log) {
  try {
    const qData = await jotformFetch(`form/${formId}/questions`, { keyType });
    return detectLevelFields(qData.content || {});
  } catch (e) {
    log.warn({ formId, err: e.message }, '[admin-sync] fields fetch failed, using empty');
    return { levelFields: [], overallStatusFieldId: null };
  }
}

async function upsertChunk(rows, log) {
  if (rows.length === 0) return 0;
  let ok = 0;
  for (const params of rows) {
    try {
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
          jotform_status=$19, answers=$20, workflow_tasks=${mergeWorkflowTasksSql('$21')}, level_history=$22, edit_link=$23,
          raw_data=$24, created_at_jf=$25, updated_at_jf=$26, days_at_level=$27, total_days=$28,
          last_synced=now(), needs_sync=$29, approval_url=$30`,
        params
      );
      ok++;
    } catch (e) {
      log.warn({ err: e.message, submissionId: params[0] }, '[admin-sync] upsert failed');
    }
  }
  return ok;
}

// ── POST /api/admin/sync-all ──
// Walks every form for the active keyType, paginates ALL submissions,
// upserts to jf_submissions. Returns per-form summary.
// Per-submission workflow-instance fetches use higher concurrency than the
// outer form loop — they're cheap reads but there are many of them.
const SUBMISSION_ENRICH_CONCURRENCY = 8;

router.post('/admin/sync-all', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    // Default: enrich each submission with its workflow-instance state (correct
    // status + workflow_tasks). Disable with ?enrich=0 for a fast/dumb sync.
    const enrichWorkflow = req.query.enrich !== '0';
    const startedAt = Date.now();
    req.log.info({ keyType, enrichWorkflow }, '[admin-sync] starting full sync');

    const formsData = await jotformFetch('user/forms', { params: { limit: 1000 }, keyType });
    const forms = (formsData.content || []).filter(f => f.id);

    let totalUpserted = 0;
    let totalFailed = 0;
    let formsDone = 0;
    let formsFailed = 0;
    const perForm = [];

    await pMapLimit(forms, FORM_CONCURRENCY, async (form) => {
      const formId = String(form.id);
      const formTitle = String(form.title || `Form ${formId}`);
      const formStart = Date.now();

      // One bad form must not abort the whole run — isolate per-form failures.
      try {
        const fields = await fetchFieldsForForm(formId, keyType, req.log);

        const { rows: rawSubs, truncated } = await fetchAllSubmissionsForForm(formId, keyType, req.log);
        if (rawSubs.length === 0) {
          formsDone++;
          perForm.push({ formId, formTitle, total: 0, upserted: 0, truncated, ms: Date.now() - formStart });
          return;
        }

        // Enrich each submission with workflow-instance status + taskList.
        // Stored as a parallel array aligned with rawSubs.
        let wfData = rawSubs.map(() => ({ status: null, taskList: [] }));
        if (enrichWorkflow) {
          wfData = await pMapLimit(rawSubs, SUBMISSION_ENRICH_CONCURRENCY,
            (raw) => fetchWorkflowInstance(raw, keyType, req.log)
          );
        }

        let formUpserted = 0;
        for (let i = 0; i < rawSubs.length; i += UPSERT_CHUNK) {
          const sliceEnd = Math.min(i + UPSERT_CHUNK, rawSubs.length);
          const chunk = [];
          for (let j = i; j < sliceEnd; j++) {
            chunk.push(mapRawToUpsertParams(rawSubs[j], formId, formTitle, fields, wfData[j].status, wfData[j].taskList));
          }
          formUpserted += await upsertChunk(chunk, req.log);
        }

        const failed = rawSubs.length - formUpserted;
        totalUpserted += formUpserted;
        totalFailed += failed;
        formsDone++;
        perForm.push({ formId, formTitle, total: rawSubs.length, upserted: formUpserted, truncated, ms: Date.now() - formStart });
        req.log.info({ formId, formTitle, total: rawSubs.length, upserted: formUpserted, truncated }, '[admin-sync] form done');
      } catch (e) {
        formsFailed++;
        req.log.warn({ formId, err: e.message }, '[admin-sync] form failed');
        perForm.push({ formId, formTitle, total: 0, upserted: 0, error: e.message, ms: Date.now() - formStart });
      }
    });

    perForm.sort((a, b) => b.total - a.total);
    const elapsedMs = Date.now() - startedAt;
    req.log.info({ keyType, totalUpserted, totalFailed, formsDone, formsFailed, elapsedMs, formCount: forms.length }, '[admin-sync] complete');
    res.json({ ok: true, keyType, formsDone, formsFailed, totalUpserted, totalFailed, formCount: forms.length, elapsedMs, perForm });
  } catch (err) { next(err); }
});

// ── GET /api/admin/sync-all-stream ──
// Same logic as POST /admin/sync-all but emits per-form progress over
// Server-Sent Events. EventSource is GET-only and cannot set custom headers,
// so keyType is read from ?keyType=... (or the header for non-SSE clients).
router.get('/admin/sync-all-stream', requireAuth, requireRole('admin'), async (req, res) => {
  const keyType = readKeyType(req);
  const startedAt = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Keep the connection alive through any front-line proxy idle timeouts.
  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);

  let clientGone = false;
  req.on('close', () => { clientGone = true; clearInterval(keepalive); });

  try {
    req.log.info({ keyType }, '[admin-sync-stream] starting full sync');
    const formsData = await jotformFetch('user/forms', { params: { limit: 1000 }, keyType });
    const forms = (formsData.content || []).filter(f => f.id);

    emit('start', { keyType, formCount: forms.length });

    let totalUpserted = 0;
    let totalFailed = 0;
    let completedCount = 0;
    let formsDone = 0;
    let formsFailed = 0;

    await pMapLimit(forms, FORM_CONCURRENCY, async (form) => {
      if (clientGone) return;
      const formId = String(form.id);
      const formTitle = String(form.title || `Form ${formId}`);
      const formStart = Date.now();

      emit('form-start', { formId, formTitle, index: completedCount, total: forms.length });

      try {
        const fields = await fetchFieldsForForm(formId, keyType, req.log);
        const { rows: rawSubs, truncated } = await fetchAllSubmissionsForForm(formId, keyType, req.log);

        // Enrich each submission with its workflow-instance status + flattened
        // taskList (assignees) — identical to POST /admin/sync-all. Without this
        // the stream wrote workflow_tasks=[] and empty approver fields, so task
        // assignees never passed the visibility gate and "Pending With" was blank.
        const wfData = await pMapLimit(rawSubs, SUBMISSION_ENRICH_CONCURRENCY,
          (raw) => fetchWorkflowInstance(raw, keyType, req.log)
        );

        let formUpserted = 0;
        for (let i = 0; i < rawSubs.length; i += UPSERT_CHUNK) {
          const sliceEnd = Math.min(i + UPSERT_CHUNK, rawSubs.length);
          const chunk = [];
          for (let j = i; j < sliceEnd; j++) {
            chunk.push(mapRawToUpsertParams(rawSubs[j], formId, formTitle, fields, wfData[j].status, wfData[j].taskList));
            // Log task assignments to email_logs
            if (wfData[j].taskList.length > 0) {
              const subId = String(rawSubs[j].id || '');
              upsertEmailLogs(subId, formId, formTitle, wfData[j].taskList)
                .catch(err => req.log.warn({ err, subId }, '[admin-sync-stream] email_logs upsert failed'));
            }
          }
          formUpserted += await upsertChunk(chunk, req.log);
        }

        const failed = rawSubs.length - formUpserted;
        totalUpserted += formUpserted;
        totalFailed += failed;
        completedCount++;
        formsDone++;

        emit('form-done', {
          formId, formTitle,
          status: 200,
          total: rawSubs.length,
          upserted: formUpserted,
          failed,
          truncated,
          ms: Date.now() - formStart,
          progress: { completed: completedCount, total: forms.length },
        });
      } catch (e) {
        // One bad form must not abort the whole run — log, count, continue.
        completedCount++;
        formsFailed++;
        req.log.warn({ formId, err: e.message }, '[admin-sync-stream] form failed');
        emit('form-error', {
          formId, formTitle,
          error: e.message,
          status: e.status || 500,
          ms: Date.now() - formStart,
          progress: { completed: completedCount, total: forms.length },
        });
      }
    });

    const elapsedMs = Date.now() - startedAt;
    req.log.info({ keyType, totalUpserted, totalFailed, formsDone, formsFailed, elapsedMs, formCount: forms.length }, '[admin-sync-stream] complete');
    emit('done', { ok: true, keyType, formsDone, formsFailed, totalUpserted, totalFailed, formCount: forms.length, elapsedMs });
  } catch (err) {
    req.log.error({ err: err.message }, '[admin-sync-stream] failed');
    try { emit('error', { message: err.message }); } catch {}
  } finally {
    clearInterval(keepalive);
    try { res.end(); } catch {}
  }
});

module.exports = router;
