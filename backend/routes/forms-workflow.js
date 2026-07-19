const { Router } = require('express');
const env = require('../config/env');
const pool = require('../db/pool');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { isPrefillConfigured, resolvePrefillUrl } = require('../lib/prefill');
const { readKeyType } = require('../lib/key-type');
const { storageProfileId } = require('../lib/profiles');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { isAdminRole } = require('../lib/visibility');
const { extractTask } = require('../lib/workflow-task');
const { pollOnce } = require('../lib/poller');
const { applyResourceShareLinks, linkResponse, buildWorkflowTaskUrl, tokenFromLink, pickShareLink } = require('../lib/jotform-link');
const { pMapLimit } = require('../lib/concurrency');
const {
  formIdRequiredQuerySchema,
  formIdOptionalQuerySchema,
  formAndSubmissionQuerySchema,
} = require('../schemas/forms');

const router = Router();

router.use(requireAuth);

const quickSyncAt = new Map();

function scheduleQuickSync(profileId) {
  const now = Date.now();
  if (now - (quickSyncAt.get(profileId) || 0) < 10_000) return;
  quickSyncAt.set(profileId, now);
  pollOnce({ profileId, quick: true }).catch(err => {
    console.warn(`[active-form-ids] quick sync failed for ${profileId}:`, err.message);
  });
}

// ── Email token link resolution ──
// JotForm only sends the /share/{token} access link in the assignment email.
// These helpers fetch the recent email event log, find the email for the
// given submission addressed to the logged-in user, and extract the action URL.

const emailTokenCache = new Map(); // `${userEmail}:${submissionId}` → { link, at }
const EMAIL_TOKEN_TTL = 15 * 60 * 1000;

function extractEmailLinks(html) {
  if (!html) return [];
  const results = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (url.startsWith('http')) results.push({ url, text });
  }
  return results;
}

function pickArchivedActionLink(rows, requestedTaskId = '') {
  const links = [];
  for (const row of rows) {
    const actionLinks = Array.isArray(row.action_links) ? row.action_links : [];
    for (const link of actionLinks) {
      const url = String(link?.url || '').trim();
      const type = String(link?.type || '').toLowerCase();
      if (!url || type === 'reject') continue;
      links.push(link);
    }
  }
  if (!links.length) return null;
  if (requestedTaskId) {
    const exact = links.find(link => String(link.taskId || '') === String(requestedTaskId));
    if (exact?.url) return exact.url;
  }
  const preferred = links.find(link => ['fill', 'task', 'approve'].includes(String(link.type || '').toLowerCase()));
  return preferred?.url || links[0]?.url || null;
}

async function resolveArchivedEmailTokenLink(submissionId, userEmail, profileId, requestedTaskId = '') {
  const { rows } = await pool.query(
    `SELECT action_links
       FROM jf_email_archive
      WHERE profile_id = $1
        AND submission_id = $2
        AND (lower(recipient_email) = $3 OR lower(to_addr) LIKE $4)
      ORDER BY sent_at DESC NULLS LAST, created_at DESC
      LIMIT 20`,
    [profileId, String(submissionId), String(userEmail || '').toLowerCase(), `%${String(userEmail || '').toLowerCase()}%`],
  );
  return pickArchivedActionLink(rows, requestedTaskId);
}

// The clean "Open Task" link JotForm puts in assignment emails. We prefer the
// exact URL captured in the mail tables; this is only a last-resort rebuild.
function buildShareUrl(token) {
  return token ? `${env.JOTFORM_HOST}/share/${encodeURIComponent(token)}` : '';
}

/**
 * Resolve the actual "Open Task" /share/ link JotForm emailed the assignee for
 * their pending step — the link the user asked to see in the portal.
 *
 * Reads, in priority order, from the synced mail tables (no live API call):
 *   1. jotform_mail_sender — the Gmail Sent-folder copy (action_links column)
 *   2. jf_email_archive   — JotForm's own system-log copy (per submission+user)
 *   3. email_logs         — stored per-task access link → derive /share/
 * and verifies the link belongs to THIS task via its token / taskId. Returns the
 * raw /share/ URL, or '' when no sent link is on record yet.
 */
async function resolveSentShareLink({ submissionId, userEmail, profileId, taskToken = '', taskId = '' }) {
  const email = String(userEmail || '').toLowerCase();
  if (!email) return '';
  const like = `%${email}%`;

  // 1. Gmail Sent-folder copy — scoped to the recipient, newest first.
  const ms = await pool.query(
    `SELECT action_links, sent_at
       FROM jotform_mail_sender
      WHERE profile_id = $1 AND (recipient_emails::text ILIKE $2 OR to_addr ILIKE $2)
      ORDER BY sent_at DESC NULLS LAST, message_uid DESC
      LIMIT 40`,
    [profileId, like],
  );
  let url = pickShareLink(ms.rows, taskToken, taskId);
  if (url) return url;

  // 2. JotForm system-log archive — scoped to this submission + recipient.
  const ar = await pool.query(
    `SELECT action_links, sent_at
       FROM jf_email_archive
      WHERE profile_id = $1 AND submission_id = $2
        AND (lower(recipient_email) = $3 OR lower(to_addr) LIKE $4)
      ORDER BY sent_at DESC NULLS LAST, created_at DESC
      LIMIT 40`,
    [profileId, String(submissionId), email, like],
  );
  url = pickShareLink(ar.rows, taskToken, taskId);
  if (url) return url;

  // 3. email_logs stored access link → derive the /share/ form from its token.
  const params = [String(submissionId), email];
  let taskClause = '';
  if (taskId) { params.push(String(taskId)); taskClause = `AND task_id = $3`; }
  const el = await pool.query(
    `SELECT access_link
       FROM email_logs
      WHERE submission_id = $1 AND lower(assignee_email) = $2 ${taskClause}
        AND COALESCE(access_link, '') <> ''
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 5`,
    params,
  );
  for (const r of el.rows) {
    const tok = tokenFromLink(r.access_link);
    if (tok && (!taskToken || tok === taskToken)) return buildShareUrl(tok);
  }

  // 4. Last resort: rebuild from the pending task's own token.
  return taskToken ? buildShareUrl(taskToken) : '';
}

async function resolveEmailTokenLink(submissionId, formId, userEmail, profileId, requestedTaskId = '', requirePrefill = false) {
  const archivedLink = await resolveArchivedEmailTokenLink(submissionId, userEmail, profileId, requestedTaskId);
  if (archivedLink && (!requirePrefill || /\/prefill\//i.test(archivedLink))) return archivedLink;

  const logsData = await jotformFetch('enterprise/system-logs', {
    params: { 'event[0]': 'email', limit: 50, sortWay: 'DESC' },
    keyType: profileId,
    timeoutMs: 15000,
  });
  const entries = Array.isArray(logsData.content) ? logsData.content
    : Array.isArray(logsData.data) ? logsData.data
    : Array.isArray(logsData) ? logsData : [];

  // Find log entries whose raw JSON mentions this submission or form ID
  const candidates = entries.filter(e => {
    const s = JSON.stringify(e).toLowerCase();
    return s.includes(String(submissionId).toLowerCase()) ||
           (formId && s.includes(String(formId).toLowerCase()));
  });

  for (const entry of candidates.slice(0, 5)) {
    const emailId = String(
      entry.emailId || entry.email_id || entry.emailID || entry.id || entry.resource_id || ''
    );
    if (!emailId) continue;

    const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: profileId, timeoutMs: 10000 });
    const c = emailData.content || emailData;

    // Verify this email was sent to the requesting user
    const toRaw = c.to || c.recipient || c.email || c.recipientEmail || '';
    const toAddr = String(Array.isArray(toRaw) ? toRaw.join(',') : toRaw).toLowerCase();
    if (!toAddr.includes(userEmail)) continue;

    // Extract links from the email body; prefer task/form/share URLs
    const body = c.body || c.html || c.message || '';
    const links = extractEmailLinks(body);

    const preferred = links.find(l => {
      const u = l.url.toLowerCase();
      const t = l.text.toLowerCase();
      if (requirePrefill) return u.includes('/prefill/');
      return u.includes('/share/') || u.includes('/approval-form/')
        || t.includes('fill') || t.includes('complete') || t.includes('open task')
        || t.includes('view task') || t.includes('start');
    }) || links.find(l => {
      const u = l.url.toLowerCase();
      return u.includes(env.JOTFORM_HOST && env.JOTFORM_HOST.replace(/^https?:\/\//, ''))
        || u.includes('jotform');
    });

    if (preferred) return preferred.url;
  }
  return null;
}

// ── GET /api/team-form-ids ──
// Returns the form IDs that belong to the Testing team (env.JOTFORM_TEAM_ID).
// Always uses the default key + teamID — independent of x-jotform-key-type
// header — so Production callers can subtract these from their enterprise
// list to get a pure Production-only view (excluding shared Testing forms).
const teamFormIdsCache = { ids: null, at: 0 };
const TEAM_FORM_IDS_TTL = 5 * 60 * 1000;

router.get('/team-form-ids', async (req, res, next) => {
  try {
    if (!env.JOTFORM_TEAM_ID) return res.json({ ids: [] });
    if (teamFormIdsCache.ids && Date.now() - teamFormIdsCache.at < TEAM_FORM_IDS_TTL) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json({ ids: teamFormIdsCache.ids, cached: true });
    }
    // Force keyType='default' so teamID is appended and we get team-scoped forms.
    const data = await jotformFetch('user/forms', { params: { limit: 1000 }, keyType: 'default' });
    const ids = (data.content || []).map(f => String(f.id)).filter(Boolean);
    teamFormIdsCache.ids = ids;
    teamFormIdsCache.at = Date.now();
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ ids });
  } catch (err) { next(err); }
});

// ── GET /api/active-form-ids ──
// Returns the form metadata (id + title + count) in scope for the active key.
// Testing: forms in the configured team (user/forms?teamID).
// Production: forms for the active API profile only.
// Frontend uses this to know which form_ids to query in jf_submissions —
// removing the need for the frontend to call /api/jotform directly.

router.get('/active-form-ids', async (req, res, next) => {
  try {
    const requestedProfileId = readKeyType(req);
    const profileId = storageProfileId(requestedProfileId);
    const allTeamWorkspaces = String(req.session.role || '').toLowerCase() === 'super_admin' && !requestedProfileId.includes('__team_');
    scheduleQuickSync(requestedProfileId);
    // Serve from synced jf_forms table — no live JotForm API call needed.
    // Poller keeps jf_forms up to date every POLL_INTERVAL_MINUTES.
    const { rows } = await pool.query(
      `SELECT f.form_id AS id,
              f.title,
              f.status,
              f.updated_at_jf AS updated_at,
              count(s.jotform_submission_id)::int AS count
         FROM team_workspace_forms f
         LEFT JOIN jf_submissions s
           ON s.form_id = f.form_id
          AND s.profile_id = f.team_workspace_id
        WHERE ${allTeamWorkspaces ? `(f.team_workspace_id = $1 OR f.team_workspace_id LIKE $1 || '__team_%')` : 'f.team_workspace_id = $1'}
         GROUP BY f.form_id, f.title, f.status, f.updated_at_jf
         ORDER BY f.title`,
      [profileId]
    );
    const params = [profileId];
    let where = allTeamWorkspaces
      ? `WHERE (profile_id = $1 OR profile_id LIKE $1 || '__team_%')`
      : 'WHERE profile_id = $1';
    if (!isAdminRole(req.session.role)) {
      const email = String(req.session.email || '').toLowerCase();
      params.push(email, `%${email}%`);
      where += ` AND (
        lower(coalesce(submitter_email, '')) = $2
        OR lower(coalesce(pending_approver_email, '')) = $2
        OR lower(coalesce(approver_email, '')) = $2
        OR lower(workflow_tasks::text) LIKE $3
        OR lower(level_history::text) LIKE $3
      )`;
    }
    const fallback = await pool.query(
      `SELECT form_id AS id, max(form_title) AS title, max(status) AS status,
              max(updated_at_jf) AS updated_at, count(jotform_submission_id)::int AS count
         FROM jf_submissions
         ${where}
        GROUP BY form_id
        ORDER BY max(form_title)`,
      params
    );
    const byId = new Map(rows.map(row => [String(row.id), row]));
    for (const row of fallback.rows) byId.set(String(row.id), { ...byId.get(String(row.id)), ...row });
    const formRows = [...byId.values()];
    const forms = formRows.map(f => ({
      id: String(f.id),
      title: String(f.title || `Form ${f.id}`),
      status: String(f.status || ''),
      count: Number(f.count || 0),
      updatedAt: f.updated_at || null,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ keyType: requestedProfileId, forms });
  } catch (err) { next(err); }
});

// ── GET /api/form-workflow?formId=xxx ──
const workflowCache = {};
const CACHE_TTL = 60 * 60 * 1000;

function detectStepType(label) {
  const t = label.toLowerCase();
  if (/\b(task|todo|to-do|action item|procurement|finance|payment|processing|raise po|raise order)\b/.test(t))
    return 'task';
  if (/\b(fill|complete form|evaluation|evaluate|assessment|review form|submit form)\b/.test(t))
    return 'form';
  return 'approval';
}

router.get('/form-workflow', validate(formIdRequiredQuerySchema, 'query'), async (req, res, next) => {
  try {
    const formId = req.query.formId;
    const keyType = readKeyType(req);
    // Cache key includes keyType — same formId resolved against default vs gdmo
    // returns different shapes (different teams / scopes), so they must not collide.
    const cacheKey = `${keyType}:${formId}`;

    const cached = workflowCache[cacheKey];
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json({ formId, steps: cached.steps, cached: true });
    }

    if (!resolveApiKey(keyType)) {
      return res.json({ formId, steps: [], source: 'no-api-key' });
    }

    const qData = await jotformFetch(`form/${formId}/questions`, { keyType });
    const questions = qData.content || {};

    const candidates = [];
    for (const [qid, q] of Object.entries(questions)) {
      if (q.type !== 'control_dropdown' || !q.text) continue;
      const t = q.text.toLowerCase();
      if (/\b(level|approval|task|step|evaluation|finance|form completion|todo)\b/.test(t)) {
        candidates.push({ qid, text: q.text, order: parseInt(q.order || '999') });
      }
    }
    candidates.sort((a, b) => a.order - b.order);

    const steps = candidates.map((c, i) => ({
      level: i + 1, type: detectStepType(c.text), label: c.text, questionId: c.qid,
    }));

    // Try form properties for assignee emails
    try {
      const propsData = await jotformFetch(`form/${formId}/properties`, { keyType });
      const props = propsData.content || {};
      if (props.flow || props.approverEmails || props.conditions) {
        const flowData = props.flow || props.approverEmails || props.conditions;
        const flowStr = typeof flowData === 'string' ? flowData : JSON.stringify(flowData);
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = flowStr.match(emailPattern) || [];
        for (let i = 0; i < Math.min(emails.length, steps.length); i++) {
          if (!steps[i].assigneeEmail) steps[i].assigneeEmail = emails[i];
        }
      }
      for (const [key, value] of Object.entries(props)) {
        if (typeof value !== 'string') continue;
        const lvlPropMatch = key.match(/(?:approver|assignee|evaluator)[_\s]*(\d+)/i);
        if (lvlPropMatch) {
          const lvl = parseInt(lvlPropMatch[1]);
          const step = steps.find(s => s.level === lvl);
          if (step && !step.assigneeEmail && value.includes('@')) step.assigneeEmail = value;
        }
      }
    } catch (e) {
      req.log.warn({ err: e, formId }, '[forms] form properties fetch failed');
    }

    workflowCache[cacheKey] = { steps, at: Date.now() };
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ formId, steps });
  } catch (err) { next(err); }
});

// ── GET /api/detect-approvers?formId=xxx ──
router.get('/detect-approvers', validate(formIdOptionalQuerySchema, 'query'), async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const targetFormId = req.query.formId;
    let forms = [];
    if (targetFormId) {
      forms = [{ id: targetFormId }];
    } else {
      const formsData = await jotformFetch('user/forms', { params: { limit: '100', status: 'ENABLED' }, keyType });
      forms = (formsData.content || []).map(f => ({ id: String(f.id) }));
    }

    // JotForm has no batch endpoint for questions or submissions across forms,
    // so run per-form work with bounded concurrency. Within each form the two
    // independent fetches (questions + submissions) run in parallel.
    const perForm = await pMapLimit(forms, 5, async (form) => {
      const qData = await jotformFetch(`form/${form.id}/questions`, { keyType });
      const questions = qData.content || {};

      const approverFields = [];
      for (const [qid, q] of Object.entries(questions)) {
        const lbl = (q.text || q.name || '');
        const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)\s*(?:approver|approved\s*by|reviewer)/i);
        if (lvlMatch) approverFields.push({ qid, level: parseInt(lvlMatch[1]) });
      }
      if (approverFields.length === 0) return [];

      const subData = await jotformFetch(`form/${form.id}/submissions`, {
        params: { limit: '100', orderby: 'created_at', direction: 'DESC' },
        keyType,
      });
      const submissions = subData.content || [];

      const approverCounts = {};
      for (const sub of submissions) {
        const answers = sub.answers || {};
        for (const af of approverFields) {
          const answer = answers[af.qid]?.answer;
          if (!answer || typeof answer !== 'string') continue;
          const match = answer.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
          let name, email;
          if (match) { name = match[1].trim(); email = match[2].trim(); }
          else {
            const nameOnly = answer.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
            if (nameOnly) { name = nameOnly[1].trim(); email = ''; }
            else continue;
          }
          if (!name) continue;
          const key = `${form.id}:${af.level}:${email || name}`;
          if (!approverCounts[key]) approverCounts[key] = { name, email: email || '', count: 0 };
          approverCounts[key].count++;
        }
      }

      const out = [];
      for (const af of approverFields) {
        const candidates = Object.entries(approverCounts)
          .filter(([k]) => k.startsWith(`${form.id}:${af.level}:`))
          .map(([, v]) => v)
          .sort((a, b) => b.count - a.count);
        if (candidates.length > 0) {
          out.push({
            formId: form.id, level: af.level,
            approverName: candidates[0].name, approverEmail: candidates[0].email,
            count: candidates[0].count,
          });
        }
      }
      return out;
    });

    const detectedApprovers = perForm.flat();
    res.json({ detectedApprovers });
  } catch (err) { next(err); }
});

// ── GET /api/email-url?formId=xxx&submissionId=yyy&taskId=optional ──
router.get('/email-url', validate(formAndSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { formId, submissionId } = req.query;
    const requestedTaskId = String(req.query.taskId || '');
    const formResponse = (source, task = {}) => linkResponse({
      url: buildWorkflowTaskUrl(task, formId), source, formId, submissionId, task,
    });
    const noLinkResponse = (source, reason, task = {}, action = 'open') => ({
      ...linkResponse({ url: '', source, formId, submissionId, task }),
      reason,
      action,
    });

    // Step 1: Read active task from DB (workflow_tasks JSONB) — no API call needed.
    // JotForm never exposes every email token via API, so deterministic task
    // URLs are constructed from the stored task type, form ID, and task ID.
    const { rows: subRows } = await pool.query(
      `SELECT workflow_tasks,
              profile_id,
              COALESCE(raw_data->>'workflowInstanceID', raw_data->>'workflow_instance_id') AS wid
       FROM jf_submissions
       WHERE jotform_submission_id = $1 AND form_id = $2
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [submissionId, formId]
    );
    const profileId = subRows[0]?.profile_id || readKeyType(req);

    const myEmail = (req.session.email || '').toLowerCase();
    const adminView = isAdminRole(req.session.role);
    const isConstructedTask = task => String(task?.type || '') === 'workflow_assign_form';
    const canOpenTask = task => String(task?.assigneeEmail || '').toLowerCase() === myEmail || (adminView && isConstructedTask(task));
    const dbTasks = Array.isArray(subRows[0]?.workflow_tasks) ? subRows[0].workflow_tasks : [];
    const activeDbTasks = dbTasks.filter(t => String(t.status).toUpperCase() === 'ACTIVE');
    const requestedDbTask = requestedTaskId
      ? activeDbTasks.find(t => String(t.taskId || '') === requestedTaskId)
      : null;
    // Prefer the task assigned to THIS user (parallel steps have several
    // ACTIVE tasks). A personal /share/{token} link must only ever go to its
    // own assignee. Admins may use deterministic form/task URLs, never another
    // assignee's personal approval token.
    const requestedTaskCanOpen = requestedDbTask && canOpenTask(requestedDbTask);
    const myDbTask = requestedTaskCanOpen
      ? requestedDbTask
      : activeDbTasks.find(t => String(t.assigneeEmail || '').toLowerCase() === myEmail);
    const activeDbTask = requestedDbTask || myDbTask || activeDbTasks[0];

    // Shared email-token lookup (cached). The /share/{token} URL for any user
    // other than the API key's own account exists ONLY in the email JotForm
    // sent them — the workflow API returns an empty accessLink for everyone else.
    const lookupEmailLink = async (requirePrefill = false) => {
      const userEmail = (req.session.email || '').toLowerCase();
      if (!userEmail) return null;
      const cacheKey = `${profileId}:${userEmail}:${submissionId}:${requestedTaskId || 'active'}:${requirePrefill ? 'prefill' : 'any'}`;
      const cached = emailTokenCache.get(cacheKey);
      if (cached && Date.now() - cached.at < EMAIL_TOKEN_TTL) return cached.link || null;
      try {
        const link = await resolveEmailTokenLink(submissionId, formId, userEmail, profileId, requestedTaskId, requirePrefill);
        emailTokenCache.set(cacheKey, { link, at: Date.now() });
        return link;
      } catch (emailErr) {
        req.log?.warn({ err: emailErr, submissionId }, '[email-url] email token lookup failed');
        return null;
      }
    };

    let liveLookupPromise = null;
    const loadLiveLookup = async () => {
      const workflowInstanceID = subRows[0]?.wid;
      if (!workflowInstanceID) return null;
      if (!liveLookupPromise) {
        liveLookupPromise = jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType: profileId })
          .then((instData) => {
            const rawTasks = Array.isArray(instData?.content?.taskList) ? instData.content.taskList : [];
            const storedById = new Map(dbTasks.map(t => [String(t.taskId || ''), t]));
            const tasks = rawTasks.map((t, idx) => {
              const task = extractTask(t, idx + 1);
              const stored = storedById.get(task.taskId);
              return task.type === 'workflow_assign_form' && stored?.accessLink?.includes('/prefill/')
                ? { ...task, accessLink: stored.accessLink }
                : task;
            });
            applyResourceShareLinks(tasks, instData?.content?.resourceShares || [], formId);
            const activeTasks = tasks.filter(t => String(t.status).toUpperCase() === 'ACTIVE');
            const tasksById = new Map(tasks.map(t => [String(t.taskId || ''), t]));
            return { tasks, activeTasks, tasksById };
          })
          .catch((apiErr) => {
            req.log.warn({ err: apiErr, submissionId }, '[email-url] live workflow lookup failed, using DB');
            return null;
          });
      }
      return liveLookupPromise;
    };

    const hydrateTaskFromLive = async (task) => {
      if (!task?.taskId || String(task.type || '') === 'workflow_assign_form') return task;
      const currentFormId = String(task.internalFormID || '');
      // For assign_task / approval, parent form ID is not enough. JotForm's live
      // workflow task carries the task form ID used in /approval-form/{id}/...
      if (currentFormId && currentFormId !== String(formId)) return task;
      const live = await loadLiveLookup();
      const liveTask = live?.tasksById?.get(String(task.taskId || ''));
      if (!liveTask?.internalFormID) return task;
      return {
        ...task,
        type: task.type || liveTask.type,
        name: task.name || liveTask.name,
        status: task.status || liveTask.status,
        assigneeEmail: task.assigneeEmail || liveTask.assigneeEmail,
        internalFormID: liveTask.internalFormID,
        accessLink: task.accessLink || liveTask.accessLink,
      };
    };

    const persistPrefillUrl = (task, url) => pool.query(
      `UPDATE jf_submissions
          SET workflow_tasks = (
            SELECT jsonb_agg(CASE WHEN t->>'taskId' = $3
              THEN jsonb_set(t, '{accessLink}', to_jsonb($4::text), true)
              ELSE t END)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(workflow_tasks) = 'array'
                THEN workflow_tasks ELSE '[]'::jsonb END
            ) t
          ), last_synced = now()
        WHERE jotform_submission_id = $1 AND form_id = $2`,
      [submissionId, formId, task.taskId || '', url],
    ).catch(err => req.log?.warn({ err, submissionId, taskId: task.taskId }, '[email-url] prefill URL persistence failed'));

    const resolveTaskResponse = async (task, sourcePrefix = 'db') => {
      const effectiveTask = await hydrateTaskFromLive(task);
      if (effectiveTask.type === 'workflow_assign_task') {
        const { rows: storedTaskLinks } = await pool.query(
          `SELECT task_url, task_form_id
             FROM team_workspace_task_urls
            WHERE team_workspace_id=$1 AND submission_id=$2 AND task_id=$3
              AND task_status='ACTIVE' AND lower(assignee_email)=lower($4)
            ORDER BY updated_at DESC LIMIT 1`,
          [storageProfileId(profileId), submissionId, effectiveTask.taskId, myEmail],
        );
        const storedTask = storedTaskLinks[0];
        if (storedTask?.task_url) {
          return formResponse('workspace-task-link', {
            ...effectiveTask,
            internalFormID: storedTask.task_form_id || effectiveTask.internalFormID,
            accessLink: storedTask.task_url,
          });
        }
        const sentShare = await resolveSentShareLink({
          submissionId, userEmail: myEmail, profileId,
          taskToken: tokenFromLink(effectiveTask.accessLink), taskId: effectiveTask.taskId,
        });
        if (sentShare) return formResponse('sent-task-link', { ...effectiveTask, accessLink: sentShare });
        const emailLink = await lookupEmailLink();
        if (emailLink) return formResponse('email-task-link', { ...effectiveTask, accessLink: emailLink });
        return noLinkResponse(
          `${sourcePrefix}-task-link-missing`,
          'No matching assigned-task access URL was found.',
          effectiveTask,
        );
      }
      // For assigned forms, only a /prefill/ link is safe to open: it carries
      // the parent submission's data and prevents a second, unlinked form.
      if (effectiveTask.type === 'workflow_assign_form' && effectiveTask.internalFormID) {
        const taskId = effectiveTask.taskId || '';
        const prefillUrl = await resolvePrefillUrl({
          formId: effectiveTask.internalFormID, submissionId, taskId,
          assigneeEmail: effectiveTask.assigneeEmail, profileId,
        });
        if (prefillUrl) {
          await persistPrefillUrl(effectiveTask, prefillUrl);
          effectiveTask.accessLink = prefillUrl;
          return linkResponse({ url: prefillUrl, source: `${sourcePrefix}-prefill-url`, formId, submissionId, task: effectiveTask });
        }
        const emailPrefillUrl = await lookupEmailLink(true);
        if (emailPrefillUrl && /\/prefill\//i.test(emailPrefillUrl)) {
          await persistPrefillUrl(effectiveTask, emailPrefillUrl);
          effectiveTask.accessLink = emailPrefillUrl;
          return linkResponse({ url: emailPrefillUrl, source: `${sourcePrefix}-email-prefill-url`, formId, submissionId, task: effectiveTask });
        }
        if (String(effectiveTask.accessLink || '').includes('/prefill/')) {
          return linkResponse({ url: effectiveTask.accessLink, source: `${sourcePrefix}-access-link`, formId, submissionId, task: effectiveTask });
        }
        if (await isPrefillConfigured(effectiveTask.internalFormID, profileId) === false) {
          const url = buildWorkflowTaskUrl({ ...effectiveTask, prefillState: 'not_required' }, formId);
          return linkResponse({ url, source: `${sourcePrefix}-form-url`, formId, submissionId, task: effectiveTask });
        }
        return noLinkResponse(
          `${sourcePrefix}-prefill-missing`,
          'No matching prefill URL was returned by JotForm for this submission.',
          effectiveTask,
        );
      }

      if (effectiveTask.type === 'workflow_assign_form') {
        return noLinkResponse(`${sourcePrefix}-form-id-missing`, 'Assigned form ID is missing.', effectiveTask);
      }

      // Approval links may still carry a personal token.
      const sentShare = await resolveSentShareLink({
        submissionId, userEmail: myEmail, profileId,
        taskToken: tokenFromLink(effectiveTask.accessLink), taskId: effectiveTask.taskId,
      });
      if (sentShare) {
        return formResponse('sent-share-link', { ...effectiveTask, accessLink: sentShare });
      }
      const emailLink = await lookupEmailLink();
      if (emailLink) {
        return formResponse('email-token', { ...effectiveTask, accessLink: emailLink });
      }
      return formResponse(`${sourcePrefix}-constructed-approval-url`, effectiveTask);
    };

    const live = await loadLiveLookup();
    if (live && live.tasks.length > 0) {
      const requestedLiveTask = requestedTaskId ? live.tasksById.get(requestedTaskId) : null;
      if (requestedTaskId && requestedLiveTask) {
        if (String(requestedLiveTask.status).toUpperCase() !== 'ACTIVE') {
          return res.json(noLinkResponse('form-task-not-active', 'The requested workflow step is not active.', requestedLiveTask));
        }
        if (!canOpenTask(requestedLiveTask)) {
          return res.json(noLinkResponse('form-not-assignee', 'This workflow step is assigned to another user.', requestedLiveTask));
        }
        return res.json(await resolveTaskResponse(requestedLiveTask, 'api'));
      }

      const myLiveTask = live.activeTasks.find(t => String(t.assigneeEmail || '').toLowerCase() === myEmail);
      if (myLiveTask) {
        return res.json(await resolveTaskResponse(myLiveTask, 'api'));
      }
      if (live.activeTasks.length > 0) {
        return res.json(noLinkResponse('form-not-assignee', 'The active workflow step is assigned to another user.'));
      }
      return res.json(noLinkResponse('form-no-active-task', 'No active workflow step was found.'));
    }

    if (requestedDbTask && !requestedTaskCanOpen) {
      return res.json(noLinkResponse('form-not-assignee', 'This workflow step is assigned to another user.', requestedDbTask));
    }

    if (myDbTask) {
      return res.json(await resolveTaskResponse(myDbTask, 'db'));
    }

    if (activeDbTask) {
      return res.json(noLinkResponse('form-not-assignee', 'The active workflow step is assigned to another user.', activeDbTask));
    }

    // Step 2: DB has no active task — try live JotForm API for fresher data.
    try {
      const workflowInstanceID = subRows[0]?.wid;
      if (workflowInstanceID) {
        const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType: profileId });
        const taskList = instData?.content?.taskList || [];
        // Same user-scoping as the DB path: only this user's own active task
        // may yield a personal link.
        const requestedActiveTask = requestedTaskId
          ? taskList.find(t => String(t.id || '') === requestedTaskId && String(t.status).toUpperCase() === 'ACTIVE')
          : null;
        const requestedApiTaskCanOpen = requestedActiveTask && canOpenTask(extractTask(requestedActiveTask));
        const activeTask = requestedApiTaskCanOpen
          ? requestedActiveTask
          : taskList.find(t =>
              String(t.status).toUpperCase() === 'ACTIVE' &&
              String(extractTask(t).assigneeEmail).toLowerCase() === myEmail
            );

        if (requestedActiveTask && !requestedApiTaskCanOpen) {
          return res.json(noLinkResponse('form-not-assignee', 'This workflow step is assigned to another user.', extractTask(requestedActiveTask)));
        }

        if (activeTask) {
          return res.json(await resolveTaskResponse(extractTask(activeTask), 'api-fallback'));
        }
      }
    } catch (apiErr) {
      req.log.warn({ err: apiErr, submissionId }, '[email-url] JotForm API lookup failed');
    }

    res.json(noLinkResponse('form-no-active-task', 'No active workflow step was found.'));
  } catch (err) {
    // Never return a guessed form/inbox URL after a resolver failure.
    const fId = req.query.formId;
    const sId = req.query.submissionId;
    req.log?.warn({ err }, '[email-url] unexpected link resolver error');
    res.json({
      ...linkResponse({ url: '', formId: fId, submissionId: sId, source: 'link-resolution-error' }),
      reason: 'Could not resolve a valid JotForm action URL.',
      action: 'open',
    });
  }
});

// ── GET /api/form-url?formId=xxx&submissionId=yyy ──
router.get('/form-url', validate(formAndSubmissionQuerySchema, 'query'), (req, res) => {
  const { formId, submissionId } = req.query;
  res.json({ formUrl: `${env.JOTFORM_HOST}/${formId}`, formId, submissionId, source: 'constructed-form' });
});

// ── GET /api/task-url?formId=xxx&submissionId=yyy ──
router.get('/task-url', validate(formAndSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
  const { formId, submissionId } = req.query;
    const { rows } = await pool.query(
      `SELECT task_url, task_id, task_form_id
         FROM team_workspace_task_urls
        WHERE team_workspace_id=$1 AND submission_id=$2 AND form_id=$3
          AND task_status='ACTIVE' AND lower(assignee_email)=lower($4)
        ORDER BY updated_at DESC LIMIT 1`,
      [storageProfileId(readKeyType(req)), submissionId, formId, req.session.email || '']
    );
    res.json({
      taskUrl: rows[0]?.task_url || '',
      taskId: rows[0]?.task_id || '',
      taskFormId: rows[0]?.task_form_id || '',
      formId,
      submissionId,
      source: rows[0] ? 'workspace-task-url' : 'task-url-unavailable',
      reason: rows[0] ? '' : 'No authenticated active task URL was found for this assignee.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/task-token?submissionId=xxx&taskId=yyy ──
// Returns a magic-link URL that the assignee can click to complete the task
// without logging into JotForm or JotFlow.
router.get('/task-token', async (req, res, next) => {
  try {
    const { submissionId, taskId } = req.query;
    if (!submissionId || !taskId) {
      return res.status(400).json({ error: 'submissionId and taskId are required' });
    }
    const { getOrCreateToken } = require('../lib/task-token');
    const token = await getOrCreateToken(String(submissionId), String(taskId), '');
    const baseUrl = env.APP_URL || `${req.protocol}://${req.get('host')}`;
    return res.json({ url: `${baseUrl}/api/public/complete-task?token=${token}` });
  } catch (err) { next(err); }
});

module.exports = router;
