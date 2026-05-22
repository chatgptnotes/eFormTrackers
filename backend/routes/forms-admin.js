const { Router } = require('express');
const env = require('../config/env');
const { jotformFetch } = require('../lib/jotform');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { formIdRequiredQuerySchema } = require('../schemas/forms');

const router = Router();

// Admin-only: these endpoints mutate JotForm form definitions (adding hidden
// fields, registering webhooks). Limit to admins.
router.use(requireAuth, requireRole('admin'));

// ── POST /api/ensure-fields?formId=xxx ──
router.post('/ensure-fields', validate(formIdRequiredQuerySchema, 'query'), async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
    const formId = req.query.formId;

    const qData = await jotformFetch(`form/${formId}/questions`);
    const questions = qData.content || {};

    const existing = {};
    let overallStatusFieldId = null;
    let detectedLevelCount = 0;

    for (const [qid, q] of Object.entries(questions)) {
      const lbl = (q.text || q.name || '').toLowerCase();
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!existing[lvl]) existing[lvl] = {};
        if ((lbl.includes('evaluator') && lbl.includes('email')) || (lbl.includes('approver') && lbl.includes('email'))) {
          if (!existing[lvl].e) existing[lvl].e = qid;
        } else if (lbl.includes('status') || lbl.includes('decision') || lbl.includes('approval')) {
          if (!existing[lvl].s) existing[lvl].s = qid;
        } else if (lbl.includes('approver') || lbl.includes('approved by')) {
          if (!existing[lvl].a) existing[lvl].a = qid;
        } else if (lbl.includes('date') || lbl.includes('time')) {
          if (!existing[lvl].d) existing[lvl].d = qid;
        }
        if (lvl > detectedLevelCount) detectedLevelCount = lvl;
      }
      if (q.type === 'control_dropdown' && lbl.match(/\b(level|approval|task|step|evaluation)\b/)) {
        const stepLvlMatch = lbl.match(/(?:level|l)\s*(\d+)/);
        if (stepLvlMatch) {
          const lvl = parseInt(stepLvlMatch[1]);
          if (lvl > detectedLevelCount) detectedLevelCount = lvl;
        }
      }
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (lbl === 'status' || lbl === 'overall status' || lbl === 'final status' || lbl === 'approval status' || (lbl.includes('overall') && lbl.includes('status')))) {
        overallStatusFieldId = qid;
      }
    }

    const numLevels = detectedLevelCount || 1;
    let allExist = !!overallStatusFieldId;
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s || !existing[lvl]?.e) { allExist = false; break; }
    }

    if (allExist) {
      const fields = [];
      for (let lvl = 1; lvl <= numLevels; lvl++) {
        fields.push({
          level: lvl, statusFieldId: existing[lvl].s,
          approverFieldId: existing[lvl].a || '', dateFieldId: existing[lvl].d || '',
          evaluatorEmailFieldId: existing[lvl].e || '',
        });
      }
      return res.json({ fields, overallStatusFieldId, created: false });
    }

    // Create missing fields
    const questionsToAdd = {};
    let idx = 0;
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Status`, name: `l${lvl}Status`, hidden: 'Yes', order: String(900 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.a) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Approver`, name: `l${lvl}Approver`, hidden: 'Yes', order: String(901 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.d) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Date`, name: `l${lvl}Date`, hidden: 'Yes', order: String(902 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.e) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Evaluator Email`, name: `l${lvl}EvaluatorEmail`, hidden: 'Yes', order: String(903 + lvl * 10) }; idx++; }
    }
    if (!overallStatusFieldId) { questionsToAdd[idx] = { type: 'control_textbox', text: 'Overall Status', name: 'overallStatus', hidden: 'Yes', order: '999' }; idx++; }

    const params = new URLSearchParams();
    for (const [i, q] of Object.entries(questionsToAdd)) {
      for (const [key, val] of Object.entries(q)) {
        params.append(`questions[${i}][${key}]`, val);
      }
    }

    const createUrl = `${env.JOTFORM_BASE}/form/${formId}/questions?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return res.status(500).json({ error: `Failed to create fields: ${createRes.status}`, detail: errData });
    }
    const createData = await createRes.json();

    // Re-fetch to get new field IDs
    const q2Data = await jotformFetch(`form/${formId}/questions`);
    const updatedQ = q2Data.content || {};
    const finalFields = {};
    let finalOverall = null;

    for (const [qid, q] of Object.entries(updatedQ)) {
      const lbl = (q.text || q.name || '').toLowerCase();
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!finalFields[lvl]) finalFields[lvl] = {};
        if ((lbl.includes('evaluator') && lbl.includes('email')) || (lbl.includes('approver') && lbl.includes('email'))) {
          if (!finalFields[lvl].e) finalFields[lvl].e = qid;
        } else if (lbl.includes('status')) { if (!finalFields[lvl].s) finalFields[lvl].s = qid; }
        else if (lbl.includes('approver')) { if (!finalFields[lvl].a) finalFields[lvl].a = qid; }
        else if (lbl.includes('date')) { if (!finalFields[lvl].d) finalFields[lvl].d = qid; }
      }
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (lbl === 'overall status' || lbl === 'status' || lbl === 'final status')) finalOverall = qid;
    }

    const fields = [];
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      fields.push({
        level: lvl, statusFieldId: finalFields[lvl]?.s || '',
        approverFieldId: finalFields[lvl]?.a || '', dateFieldId: finalFields[lvl]?.d || '',
        evaluatorEmailFieldId: finalFields[lvl]?.e || '',
      });
    }

    res.json({ fields, overallStatusFieldId: finalOverall, created: true, createResponse: createData });
  } catch (err) { next(err); }
});

// ── POST /api/register-webhooks ──
router.post('/register-webhooks', async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const formsData = await jotformFetch('user/forms', { params: { limit: '200', orderby: 'updated_at' } });
    const allForms = (formsData.content || []);
    const formIds = allForms.filter(f => f.status === 'ENABLED').map(f => f.id);

    if (formIds.length === 0) return res.json({ webhookURL: '', total: 0, success: 0, errors: 0, results: [] });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const secretParam = env.JOTFORM_WEBHOOK_SECRET ? `?secret=${env.JOTFORM_WEBHOOK_SECRET}` : '';
    const webhookURL = `${proto}://${host}/api/webhook${secretParam}`;

    const results = [];
    for (const formId of formIds) {
      try {
        const params = new URLSearchParams();
        params.set('webhookURL', webhookURL);
        const url = `${env.JOTFORM_BASE}/form/${formId}/webhooks?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        results.push({ formId, status: response.ok ? 'ok' : 'error', detail: response.ok ? undefined : `HTTP ${response.status}` });
      } catch (err) {
        results.push({ formId, status: 'error', detail: String(err) });
      }
    }

    res.json({
      webhookURL, total: formIds.length,
      success: results.filter(r => r.status === 'ok').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    });
  } catch (err) { next(err); }
});

module.exports = router;
