import type { VercelRequest, VercelResponse } from '@vercel/node';

const JOTFORM_BASE = 'https://eforms.mediaoffice.ae/API';
const API_KEY = process.env.JOTFORM_API_KEY;
const TEAM_ID = process.env.JOTFORM_TEAM_ID || '260541093809054';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const KEEP_EMAIL = 'huzaifa.dawasaz@mediaoffice.ae';

interface SubmissionInfo {
  id: string;
  formId: string;
  formTitle: string;
  submittedBy: string;
  pendingEmail: string;
  pendingName: string;
  workflowInstanceId: string;
}

/**
 * GET /api/cleanup-submissions?dryRun=true   → lists what would be deleted (default)
 * GET /api/cleanup-submissions?dryRun=false  → actually deletes submissions
 *
 * Keeps only submissions where the ACTIVE workflow task assignee email is huzaifa.dawasaz@mediaoffice.ae
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'JOTFORM_API_KEY environment variable is not set' });
  }

  const dryRun = req.query.dryRun !== 'false'; // default true

  try {
    // Step 1: Fetch all forms
    const formsUrl = `${JOTFORM_BASE}/user/forms?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=100`;
    const formsRes = await fetch(formsUrl);
    const formsData = await formsRes.json();
    const forms: Array<{ id: string; title: string }> = (formsData?.content || []).map(
      (f: Record<string, unknown>) => ({ id: String(f.id), title: String(f.title || '') })
    );

    console.log(`[cleanup] Found ${forms.length} forms`);

    // Step 2: Fetch all submissions per form
    const allSubmissions: SubmissionInfo[] = [];

    for (const form of forms) {
      let offset = 0;
      const limit = 1000;
      let hasMore = true;

      while (hasMore) {
        const subUrl = `${JOTFORM_BASE}/form/${form.id}/submissions?apiKey=${API_KEY}&teamID=${TEAM_ID}&limit=${limit}&offset=${offset}&orderby=created_at&direction=DESC&addWorkflowStatus=1`;
        const subRes = await fetch(subUrl);
        const subData = await subRes.json();
        const submissions: Array<Record<string, unknown>> = subData?.content || [];

        for (const sub of submissions) {
          const id = String(sub.id);
          const workflowInstanceId = String(sub.workflowInstanceID || sub.workflow_instance_id || '');

          // Extract submitter name from answers
          const answers = (sub.answers || {}) as Record<string, Record<string, unknown>>;
          let submittedBy = '';
          for (const ans of Object.values(answers)) {
            if (ans.type === 'control_fullname' && ans.answer) {
              const parts = ans.answer as Record<string, string>;
              submittedBy = [parts.first, parts.last].filter(Boolean).join(' ');
              break;
            }
          }

          allSubmissions.push({
            id,
            formId: form.id,
            formTitle: form.title,
            submittedBy,
            pendingEmail: '',
            pendingName: '',
            workflowInstanceId,
          });
        }

        hasMore = submissions.length === limit;
        offset += limit;
      }

      console.log(`[cleanup] Form "${form.title}" (${form.id}): ${allSubmissions.filter(s => s.formId === form.id).length} submissions`);
    }

    console.log(`[cleanup] Total submissions: ${allSubmissions.length}`);

    // Step 3: For submissions with a workflow instance, fetch the active task assignee
    for (const sub of allSubmissions) {
      if (!sub.workflowInstanceId) continue;

      try {
        const instanceUrl = `${JOTFORM_BASE}/workflow/instance/${sub.workflowInstanceId}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
        const instanceRes = await fetch(instanceUrl);
        if (!instanceRes.ok) continue;

        const instanceData = await instanceRes.json();
        const taskList: Array<Record<string, unknown>> = instanceData?.content?.taskList || [];

        // Find the ACTIVE (pending) task
        for (const task of taskList) {
          const status = String(task.status || '').toUpperCase();
          if (status === 'ACTIVE' || status === 'PENDING') {
            const props = (task.properties || {}) as Record<string, unknown>;
            const assigneeUser = (props.assigneeUser || {}) as Record<string, unknown>;
            const recipients = Array.isArray(props.recipients) ? props.recipients : [];
            const firstRecipient = (recipients[0] || {}) as Record<string, unknown>;

            sub.pendingEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || task.assignee || '').toLowerCase();
            sub.pendingName = String(assigneeUser.name || firstRecipient.name || '');
            break;
          }
        }
      } catch (e) {
        console.error(`[cleanup] Failed to fetch workflow for submission ${sub.id}:`, e);
      }
    }

    // Step 4: Separate into keep vs delete
    // When KEEP_EMAIL is empty, delete ALL submissions
    const deleteAll = KEEP_EMAIL === '';
    const toKeep = deleteAll ? [] : allSubmissions.filter(s => s.pendingEmail === KEEP_EMAIL);
    const toDelete = deleteAll ? allSubmissions : allSubmissions.filter(s => s.pendingEmail !== KEEP_EMAIL);

    console.log(`[cleanup] Keeping ${toKeep.length} submissions (pendingEmail=${KEEP_EMAIL})`);
    console.log(`[cleanup] Deleting ${toDelete.length} submissions`);

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        totalSubmissions: allSubmissions.length,
        keepCount: toKeep.length,
        deleteCount: toDelete.length,
        keep: toKeep.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail, pendingName: s.pendingName })),
        delete: toDelete.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail, pendingName: s.pendingName })),
      });
    }

    // Step 5: Actually delete submissions
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const sub of toDelete) {
      try {
        const deleteUrl = `${JOTFORM_BASE}/submission/${sub.id}?apiKey=${API_KEY}&teamID=${TEAM_ID}`;
        const deleteRes = await fetch(deleteUrl, { method: 'DELETE' });
        if (deleteRes.ok) {
          deleted.push(sub.id);
          console.log(`[cleanup] Deleted submission ${sub.id} (${sub.formTitle} / ${sub.submittedBy})`);
        } else {
          const errText = await deleteRes.text().catch(() => '');
          failed.push({ id: sub.id, error: `HTTP ${deleteRes.status}: ${errText.substring(0, 200)}` });
          console.error(`[cleanup] Failed to delete ${sub.id}: ${deleteRes.status}`);
        }
      } catch (e) {
        failed.push({ id: sub.id, error: String(e) });
        console.error(`[cleanup] Error deleting ${sub.id}:`, e);
      }
    }

    return res.status(200).json({
      dryRun: false,
      totalSubmissions: allSubmissions.length,
      kept: toKeep.length,
      deleted: deleted.length,
      failed: failed.length,
      deletedIds: deleted,
      failedDetails: failed,
      keptSubmissions: toKeep.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail })),
    });
  } catch (error) {
    console.error('[cleanup] Error:', error);
    return res.status(500).json({ error: 'Cleanup failed', message: String(error) });
  }
}
