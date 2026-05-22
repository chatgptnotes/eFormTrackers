const { Router } = require('express');
const env = require('../config/env');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { pMapLimit } = require('../lib/concurrency');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

// ── GET /api/cleanup-submissions?dryRun=true|false ──
// Bulk-delete operation — admin only.
router.get('/cleanup-submissions', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const keyType = readKeyType(req);
    const KEEP_EMAIL = 'huzaifa.dawasaz@mediaoffice.ae';
    const dryRun = req.query.dryRun !== 'false';

    const formsData = await jotformFetch('user/forms', { params: { limit: '100' }, keyType });
    const forms = (formsData?.content || []).map(f => ({ id: String(f.id), title: String(f.title || '') }));

    // Per-form submission pagination must stay sequential inside a form
    // (offset depends on prior page), but different forms run concurrently.
    // JotForm has no batch "submissions for many forms" endpoint.
    const perForm = await pMapLimit(forms, 5, async (form) => {
      const collected = [];
      let offset = 0;
      const limit = 1000;
      let hasMore = true;
      while (hasMore) {
        const subData = await jotformFetch(`form/${form.id}/submissions`, {
          params: { limit: String(limit), offset: String(offset), orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
          keyType,
        });
        const submissions = subData?.content || [];
        for (const sub of submissions) {
          const answers = sub.answers || {};
          let submittedBy = '';
          for (const ans of Object.values(answers)) {
            if (ans.type === 'control_fullname' && ans.answer) {
              submittedBy = [ans.answer.first, ans.answer.last].filter(Boolean).join(' ');
              break;
            }
          }
          collected.push({
            id: String(sub.id), formId: form.id, formTitle: form.title,
            submittedBy, pendingEmail: '', pendingName: '',
            workflowInstanceId: String(sub.workflowInstanceID || sub.workflow_instance_id || ''),
          });
        }
        hasMore = submissions.length === limit;
        offset += limit;
      }
      return collected;
    });
    const allSubmissions = perForm.flat();

    // Fetch active task assignee for each submission with a workflow.
    // JotForm has no batch workflow-instance endpoint, so run with bounded
    // concurrency instead of sequential awaits.
    await pMapLimit(allSubmissions, 8, async (sub) => {
      if (!sub.workflowInstanceId) return;
      try {
        const instData = await jotformFetch(`workflow/instance/${sub.workflowInstanceId}`, { keyType });
        const taskList = instData?.content?.taskList || [];
        for (const task of taskList) {
          const st = String(task.status || '').toUpperCase();
          if (st === 'ACTIVE' || st === 'PENDING') {
            const props = task.properties || {};
            const au = props.assigneeUser || {};
            const recs = Array.isArray(props.recipients) ? props.recipients : [];
            const first = recs[0] || {};
            sub.pendingEmail = String(props.assigneeEmail || au.email || first.email || task.assignee || '').toLowerCase();
            sub.pendingName = String(au.name || first.name || '');
            break;
          }
        }
      } catch (e) {
        req.log.warn({ err: e, submissionId: sub.id }, '[submissions] workflow task fetch failed');
      }
    });

    const deleteAll = KEEP_EMAIL === '';
    const toKeep = deleteAll ? [] : allSubmissions.filter(s => s.pendingEmail === KEEP_EMAIL);
    const toDelete = deleteAll ? allSubmissions : allSubmissions.filter(s => s.pendingEmail !== KEEP_EMAIL);

    if (dryRun) {
      return res.json({
        dryRun: true, totalSubmissions: allSubmissions.length,
        keepCount: toKeep.length, deleteCount: toDelete.length,
        keep: toKeep.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail })),
        delete: toDelete.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail })),
      });
    }

    const deleted = [];
    const failed = [];
    await pMapLimit(toDelete, 8, async (sub) => {
      try {
        const urlObj = new URL(`${env.JOTFORM_BASE}/submission/${sub.id}`);
        urlObj.searchParams.set('apiKey', resolveApiKey(keyType));
        if (keyType !== 'gdmo' && env.JOTFORM_TEAM_ID) {
          urlObj.searchParams.set('teamID', env.JOTFORM_TEAM_ID);
        }
        const r = await fetch(urlObj.toString(), { method: 'DELETE' });
        if (r.ok) deleted.push(sub.id);
        else failed.push({ id: sub.id, error: `HTTP ${r.status}` });
      } catch (e) {
        failed.push({ id: sub.id, error: String(e) });
      }
    });

    res.json({
      dryRun: false, totalSubmissions: allSubmissions.length,
      kept: toKeep.length, deleted: deleted.length, failed: failed.length,
      deletedIds: deleted, failedDetails: failed,
    });
  } catch (err) { next(err); }
});

module.exports = router;
