const { jotformFetch } = require('./jotform');
const env = require('../config/env');
const { getProfile } = require('./profiles');

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
// Match by parent submission id only; if JotForm returns multiple rows for the
// same parent submission, use the newest created_at.

const prefillCache = new Map(); // `${profileId}:${formId}` -> { prefills, at }
const PREFILL_TTL = 10 * 60 * 1000; // 10 minutes

// Cached GET form/{formId}/prefills (one call serves every submission of a form).
async function getPrefills(formId, profileId) {
  const key = `${profileId || 'default'}:${formId}`;
  const hit = prefillCache.get(key);
  if (hit && Date.now() - hit.at < PREFILL_TTL) return hit.prefills;
  const teamId = getProfile(profileId).teamId || env.JOTFORM_TEAM_ID;
  const content = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await jotformFetch(`form/${formId}/prefills`, {
      keyType: profileId,
      headers: teamId ? { 'jf-team-id': teamId } : {},
      params: { limit: 1000, offset },
      timeoutMs: 20000,
    });
    const page = Array.isArray(data?.content) ? data.content : Array.isArray(data) ? data : [];
    content.push(...page);
    if (page.length < 1000) break;
  }
  // The API returns `content[]` = prefill TEMPLATES (≈1 per form); the actual
  // per-submission prefill URLs are nested under each template's `urls[]`
  // (id, created_at, settings.id = parent submission).
  // Flatten to that URL list so resolvePrefillUrl can match on settings.id.
  // The `t.settings ? [t] : []` branch tolerates an already-flat shape.
  const prefills = content.flatMap(t =>
    Array.isArray(t?.urls) ? t.urls : (t?.settings ? [t] : []));
  prefillCache.set(key, { prefills, at: Date.now() });
  return prefills;
}

// Returns the full prefill URL, or '' when no prefill matches. Never throws.
async function resolvePrefillUrl({ formId, submissionId, taskId, profileId }) {
  if (!formId || !submissionId) return '';
  try {
    const prefills = await getPrefills(formId, profileId);
    const sid = String(submissionId);
    let matches = prefills.filter(p => String(p?.settings?.id || '') === sid);
    if (matches.length === 0) return '';

    // Newest by created_at (JotForm can mint more than one URL per submission).
    matches.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const prefillId = matches[0]?.id;
    if (!prefillId) return '';

    return `${env.JOTFORM_PREFILL_HOST}/${formId}/prefill/${prefillId}?workflowAssignFormTask=1&taskID=${String(taskId || '')}`;
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
    // The API-built eforms /prefill/ URL is authoritative. Older /share/ links
    // and old-host /prefill/ links are replaced when the API can resolve them.
    const currentLink = String(task.accessLink || '');
    if (currentLink.includes('/prefill/') && currentLink.startsWith(`${env.JOTFORM_PREFILL_HOST}/`)) continue;
    if (!task.internalFormID) continue;
    const url = await resolvePrefillUrl({
      formId: task.internalFormID,
      submissionId,
      taskId: task.taskId,
      profileId,
    });
    if (url) task.accessLink = url;
    else if (currentLink && !currentLink.includes('/prefill/')) task.accessLink = '';
  }
  return flatTasks;
}

module.exports = { getPrefills, resolvePrefillUrl, enrichTasksWithPrefill };
