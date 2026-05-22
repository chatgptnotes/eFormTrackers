const { Router } = require('express');
const pool = require('../db/pool');
const { jotformFetch } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { pMapLimit } = require('../lib/concurrency');
const { requireAuth, requireRole } = require('../middleware/auth');
const { detectLevelFields } = require('../lib/detect-fields');

const router = Router();

const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_FORM = 50;
const FORM_CONCURRENCY = 3;
const UPSERT_CHUNK = 50;

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

async function fetchAllSubmissionsForForm(formId, keyType, log) {
  const all = [];
  let offset = 0;
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
  }
  return all;
}

function mapRawToUpsertParams(raw, formId, formTitle, fields) {
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

  const levelHistory = levels.map(l => ({
    level: l.id, status: l.status || 'pending',
    approver: l.approver || '', date: l.date || '',
  }));

  const genericStatus = status === 'completed' ? 'Completed' :
    status === 'rejected' ? 'Rejected' :
    levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

  return [
    String(raw.id), formId, formTitle, title, description,
    submittedBy, submittedBy, email, department,
    submissionDate.toISOString(), Math.min(currentLevel, maxLevel), status, priority, amount,
    levels.find(l => l.approver)?.approver || '', '',
    '', '',
    genericStatus,
    JSON.stringify(allAnswers), JSON.stringify([]),
    JSON.stringify(levelHistory), String(raw.edit_link || ''),
    JSON.stringify({ ...raw, _mapped: { levels, email, amount } }),
    submissionDate.toISOString(), updatedDate?.toISOString() || null,
    totalDays, totalDays,
    false, null,
  ];
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
          jotform_status=$19, answers=$20, workflow_tasks=$21, level_history=$22, edit_link=$23,
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
router.post('/admin/sync-all', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    const startedAt = Date.now();
    req.log.info({ keyType }, '[admin-sync] starting full sync');

    const formsData = await jotformFetch('user/forms', { params: { limit: 1000 }, keyType });
    const forms = (formsData.content || []).filter(f => f.id);

    let totalUpserted = 0;
    let totalFailed = 0;
    const perForm = [];

    await pMapLimit(forms, FORM_CONCURRENCY, async (form) => {
      const formId = String(form.id);
      const formTitle = String(form.title || `Form ${formId}`);
      const formStart = Date.now();

      let fields;
      try {
        const qData = await jotformFetch(`form/${formId}/questions`, { keyType });
        fields = detectLevelFields(qData.content || {});
      } catch (e) {
        req.log.warn({ formId, err: e.message }, '[admin-sync] fields fetch failed, using empty');
        fields = { levelFields: [], overallStatusFieldId: null };
      }

      const rawSubs = await fetchAllSubmissionsForForm(formId, keyType, req.log);
      if (rawSubs.length === 0) {
        perForm.push({ formId, formTitle, total: 0, upserted: 0, ms: Date.now() - formStart });
        return;
      }

      let formUpserted = 0;
      for (let i = 0; i < rawSubs.length; i += UPSERT_CHUNK) {
        const chunk = rawSubs.slice(i, i + UPSERT_CHUNK).map(raw =>
          mapRawToUpsertParams(raw, formId, formTitle, fields)
        );
        formUpserted += await upsertChunk(chunk, req.log);
      }

      const failed = rawSubs.length - formUpserted;
      totalUpserted += formUpserted;
      totalFailed += failed;
      perForm.push({ formId, formTitle, total: rawSubs.length, upserted: formUpserted, ms: Date.now() - formStart });
      req.log.info({ formId, formTitle, total: rawSubs.length, upserted: formUpserted }, '[admin-sync] form done');
    });

    perForm.sort((a, b) => b.total - a.total);
    const elapsedMs = Date.now() - startedAt;
    req.log.info({ keyType, totalUpserted, totalFailed, elapsedMs, formCount: forms.length }, '[admin-sync] complete');
    res.json({ ok: true, keyType, totalUpserted, totalFailed, formCount: forms.length, elapsedMs, perForm });
  } catch (err) { next(err); }
});

module.exports = router;
