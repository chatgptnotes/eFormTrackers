const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { syncToSupabaseBodySchema } = require('../schemas/submissions');

const router = Router();

// ── POST /api/sync-to-supabase ──
// Upserts enriched submission records from the frontend into PostgreSQL
router.post('/sync-to-supabase', validate(syncToSupabaseBodySchema), async (req, res, next) => {
  try {
    const records = req.body.records;

    let upserted = 0;
    let errors = 0;
    const errorDetails = [];
    const CHUNK = 20;

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      try {
        for (const r of chunk) {
          const numericLevel = typeof r.currentLevel === 'number' ? r.currentLevel :
            r.currentLevel === 'completed' ? 999 : 0;
          const statusStr = r.currentLevel === 'completed' ? 'completed' :
            r.currentLevel === 'rejected' ? 'rejected' : 'pending';

          await pool.query(
            `INSERT INTO jf_submissions (
              jotform_submission_id, form_id, form_title, title, description,
              submitted_by, submitter_name, submitter_email, department,
              submission_date, current_level, status, priority, jotform_status,
              pending_approver_name, pending_approver_email, approver_name,
              approver_email, answers, level_history, raw_data, approval_url, last_synced
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
            ON CONFLICT (jotform_submission_id) DO UPDATE SET
              form_id=$2, form_title=$3, title=$4, description=$5,
              submitted_by=$6, submitter_name=$7, submitter_email=$8, department=$9,
              submission_date=$10, current_level=$11, status=$12, priority=$13,
              jotform_status=$14, pending_approver_name=$15, pending_approver_email=$16,
              approver_name=$17, approver_email=$18, answers=$19, level_history=$20,
              raw_data=$21, approval_url=$22, last_synced=now()`,
            [
              r.id, r.formId, r.formTitle, r.title, r.description || r.title,
              r.submitterName, r.submitterName, r.submitterEmail, r.department,
              r.submissionDate ? new Date(r.submissionDate).toISOString() : new Date().toISOString(),
              Math.min(numericLevel, 99), statusStr, r.priority || 'medium',
              r.jotformStatus || 'Pending',
              r.pendingApproverName || '', r.pendingApproverEmail || '',
              r.pendingApproverName || '', r.pendingApproverEmail || '',
              JSON.stringify(r.answers || {}),
              JSON.stringify(r.approvalHistory || []),
              JSON.stringify({ _mapped: { levels: r.approvalHistory } }),
              r.approvalUrl || null,
            ]
          );
          upserted++;
        }
      } catch (err) {
        req.log.error({ err }, 'Upsert error');
        errorDetails.push(err.message);
        errors += chunk.length;
      }
    }

    res.json({ ok: true, upserted, errors, total: records.length, errorDetails });
  } catch (err) { next(err); }
});

module.exports = router;
