const { jotformFetch } = require('./jotform');
const env = require('../config/env');

// Resolve the JotForm prefill (access) link for workflow_assign_form tasks.
//
// When a workflow assigns a form to someone, JotForm generates a private
// PREFILLED URL that carries the parent submission's data into the new form and
// unlocks its fields:
//   {host}/{formID}/prefill/{prefillID}?workflowAssignFormTask=1&taskID={taskID}
// The API never returns this URL directly, but GET /form/{formID}/prefills lists
// EVERY prefill ever created for a form. Each entry exposes:
//   id                       -> the prefillID for the URL
//   created_at               -> creation timestamp (newest wins on duplicates)
//   settings.id              -> the PARENT submission id (== jotform_submission_id)
//   settings.metadata.email  -> the assignee the prefill was generated for
// We match by submission id + assignee email so parallel form-assign steps each
// resolve to THEIR own assignee's link.

const prefillCache = new Map(); // `${profileId}:${formId}` -> { prefills, at }
const PREFILL_TTL = 10 * 60 * 1000; // 10 minutes

// Cached GET form/{formId}/prefills (one call serves every submission of a form).
async function getPrefills(formId, profileId) {
  const key = `${profileId || 'default'}:${formId}`;
  const hit = prefillCache.get(key);
  if (hit && Date.now() - hit.at < PREFILL_TTL) return hit.prefills;
  const data = await jotformFetch(`form/${formId}/prefills`, {
    keyType: profileId,
    params: { limit: 1000 },
    timeoutMs: 20000,
  });
  // The API returns `content[]` = prefill TEMPLATES (≈1 per form); the actual
  // per-submission prefill URLs are nested under each template's `urls[]`
  // (id, created_at, settings.id = parent submission, settings.metadata.email).
  // Flatten to that URL list so resolvePrefillUrl can match on settings.id.
  // The `t.settings ? [t] : []` branch tolerates an already-flat shape.
  const content = Array.isArray(data?.content) ? data.content
    : Array.isArray(data) ? data : [];
  const prefills = content.flatMap(t =>
    Array.isArray(t?.urls) ? t.urls : (t?.settings ? [t] : []));
  prefillCache.set(key, { prefills, at: Date.now() });
  return prefills;
}

// Returns the full prefill URL, or '' when no prefill matches (callers keep
// their existing bare-URL / inbox fallback). Never throws.
async function resolvePrefillUrl({ formId, submissionId, taskId, assigneeEmail, profileId }) {
  if (!formId || !submissionId) return '';
  try {
    const prefills = await getPrefills(formId, profileId);
    const sid = String(submissionId);
    let matches = prefills.filter(p => String(p?.settings?.id || '') === sid);
    if (matches.length === 0) return '';

    const email = String(assigneeEmail || '').toLowerCase();
    if (email) {
      const byEmail = matches.filter(
        p => String(p?.settings?.metadata?.email || '').toLowerCase() === email,
      );
      if (byEmail.length) matches = byEmail;
    }

    // Newest by created_at (JotForm mints a fresh prefill on each reminder).
    matches.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const prefillId = matches[0]?.id;
    if (!prefillId) return '';

    return `${env.JOTFORM_HOST}/${formId}/prefill/${prefillId}?workflowAssignFormTask=1&taskID=${String(taskId || '')}`;
  } catch (err) {
    console.warn(`[prefill] resolve failed for form ${formId} sub ${submissionId}: ${err.message}`);
    return '';
  }
}

// Mutates a flattened task array in place: fills accessLink on every ACTIVE
// workflow_assign_form task that has an empty accessLink. Used by poller,
// webhook, admin-sync, and the backfill script so the stored link is the real
// prefill URL instead of the bare form URL.
async function enrichTasksWithPrefill(flatTasks, submissionId, profileId) {
  if (!Array.isArray(flatTasks)) return flatTasks;
  for (const task of flatTasks) {
    if (String(task.type) !== 'workflow_assign_form') continue;
    if (String(task.status).toUpperCase() !== 'ACTIVE') continue;
    // The prefill URL is authoritative for assign-form tasks. Only skip when the
    // stored link is ALREADY a prefill URL — a harvested /share/ link (which
    // opens the form WITHOUT pre-filled data) must be overwritten, not kept.
    if (String(task.accessLink || '').includes('/prefill/')) continue;
    if (!task.internalFormID) continue;
    const url = await resolvePrefillUrl({
      formId: task.internalFormID,
      submissionId,
      taskId: task.taskId,
      assigneeEmail: task.assigneeEmail,
      profileId,
    });
    if (url) task.accessLink = url;
    else if (String(task.accessLink || '').includes('/share/')) {
      task.accessLink = `${env.JOTFORM_HOST}/${task.internalFormID}?workflowAssignFormTask=1&taskID=${String(task.taskId || '')}`;
    }
  }
  return flatTasks;
}

module.exports = { getPrefills, resolvePrefillUrl, enrichTasksWithPrefill };
