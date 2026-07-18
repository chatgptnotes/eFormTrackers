const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch, resolveApiKey } = require('./jotform');
const { detectLevelFields } = require('./detect-fields');
const { emitToAll } = require('./realtime');
const { pMapLimit } = require('./concurrency');
const { extractTask, taskListFromResponse, deriveWorkflowStatus, mergeWorkflowTasksSql } = require('./workflow-task');
const { enrichTasksWithPrefill } = require('./prefill');
const { upsertEmailLogs } = require('./email-log');
const { getDefaultProfile, hasProfile, listProfiles, makeTeamProfileId } = require('./profiles');
const { upsertWorkspaceForm, upsertWorkspaceLinks } = require('./workspace-links');
const { applyResourceShareLinks, buildWorkflowTaskUrl } = require('./jotform-link');

function parseEmailFromActionText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/By:\s*[^(]*\(([^)]+@[^)]+)\)/);
  return m ? m[1].trim() : '';
}

// Max workflow-instance enrichments in flight per form. Reduced from 8 → 4 to
// avoid burst-firing the JotForm API fast enough to trigger their 429 limit.
const POLL_ENRICH_CONCURRENCY = 4;

// Delay between processing each form (ms). Spreads the full-sync API burst across time.
const INTER_FORM_DELAY_MS = 500;

// Which JotForm profile the background poller authenticates with. It has no HTTP
// request to read a header from, so it uses POLLER_KEY_TYPE (a profile id) if it
// names a real profile, otherwise the registry's default profile.
function pollerProfileId() {
  const id = env.POLLER_KEY_TYPE;
  return id && hasProfile(id) ? id : getDefaultProfile().id;
}

function field(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return '';
}

async function pollerProfileIds() {
  const raw = String(env.POLLER_KEY_TYPE || '').trim();
  if (raw && raw !== 'all') {
    const ids = raw.split(',').map(s => s.trim()).filter(hasProfile);
    return ids.length ? ids : [getDefaultProfile().id];
  }

  const ids = new Set();
  const seenAuth = new Set();
  const bases = listProfiles().filter(p => p.apiKey).filter((p) => {
    const key = `${p.apiKey}|${p.baseUrl}|${p.host}|${p.scope}|${p.teamId || ''}`;
    if (seenAuth.has(key)) return false;
    seenAuth.add(key);
    return true;
  });
  bases.forEach(p => ids.add(p.id));
  try {
    const { rows } = await pool.query(`
      SELECT profile_id FROM jf_forms
      UNION
      SELECT profile_id FROM jf_submissions
    `);
    rows.forEach(r => { if (r.profile_id && hasProfile(r.profile_id)) ids.add(r.profile_id); });
  } catch (err) {
    console.warn('[poller] DB profile discovery failed:', err.message);
  }
  for (const base of bases.filter(p => p.scope === 'user')) {
    try {
      const data = await jotformFetch('team/user/me', { keyType: base.id });
      const teams = Array.isArray(data?.content) ? data.content : data?.content ? [data.content] : [];
      for (const team of teams) {
        const teamId = field(team, 'id', 'team_id', 'teamId', 'teamID');
        if (teamId) ids.add(makeTeamProfileId(base.id, teamId));
      }
    } catch (err) {
      console.warn(`[poller] team discovery failed for ${base.id}:`, err.message);
    }
  }
  return [...ids];
}

// Workflow states that need no (more) enrichment: not yet started (no instance)
// or already finished. The submissions bulk API returns `workflowStatus` for
// free, so we use it to fetch workflow/instance only for genuinely-active ones —
// keeping each poll cheap instead of re-pulling every finished workflow.
const FINISHED_WF = new Set(['NOT_STARTED', 'COMPLETED', 'COMPLETE', 'REJECTED', 'CANCELLED', 'DECLINED']);
function workflowIsActive(status) {
  return !FINISHED_WF.has(String(status || '').toUpperCase());
}

const runningProfiles = new Set();
let pollTimer = null;
let quickTimer = null;

// Per-form questions cache — form fields rarely change, so quick polls reuse
// the structure detected by the last full poll instead of refetching it.
const questionsCache = new Map(); // formId → { detectedFields, at }
const QUESTIONS_TTL_MS = 10 * 60 * 1000;
const formsCache = new Map(); // profileId → { forms, at }
const FORMS_TTL_MS = 30 * 1000;
const PAGE_LIMIT = 1000;

async function fetchAllPages(path, profileId, params = {}) {
  const all = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const data = await jotformFetch(path, {
      params: { ...params, limit: PAGE_LIMIT, offset },
      keyType: profileId,
    });
    const rows = Array.isArray(data?.content) ? data.content : [];
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) return all;
  }
}

async function fetchEnabledForms(profileId, quick) {
  const hit = formsCache.get(profileId);
  if (hit && Date.now() - hit.at < FORMS_TTL_MS) return hit.forms;

  // Bootstrap quickly from PostgreSQL, then refresh from JotForm after the TTL
  // so forms created after startup are discovered by incremental polls.
  if (quick && !hit) {
    const { rows } = await pool.query(
      `SELECT form_id AS id, title, status FROM jf_forms WHERE profile_id = $1 AND status = 'ENABLED' ORDER BY updated_at_jf DESC NULLS LAST`,
      [profileId]
    );
    if (rows.length > 0) {
      const forms = rows.map(r => ({ id: String(r.id), title: String(r.title || ''), status: String(r.status || '') }));
      formsCache.set(profileId, { forms, at: Date.now() });
      return forms;
    }
  }

  const forms = (await fetchAllPages('user/forms', profileId, { status: 'ENABLED' })).filter(f => f.id);
  formsCache.set(profileId, { forms, at: Date.now() });
  return forms;
}

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
async function enrichWithWorkflow(submissionId, workflowInstanceId, formId, profileId) {
  try {
    let taskList = [];
    let resourceShares = [];
    try {
      const taskData = await jotformFetch(`workflow/submission/${submissionId}/tasks`, { keyType: profileId });
      taskList = taskListFromResponse(taskData);
    } catch (err) {
      console.warn(`[poller] workflow/submission tasks failed for ${submissionId}:`, err.message);
    }
    if (workflowInstanceId) {
      const instData = await jotformFetch(`workflow/instance/${workflowInstanceId}`, { keyType: profileId });
      if (taskList.length === 0) taskList = instData?.content?.taskList || [];
      resourceShares = instData?.content?.resourceShares || [];
    }
    // Flatten to the shape every reader expects (top-level assigneeEmail etc.) —
    // matches admin-sync. Raw JotForm tasks nest the assignee under
    // properties.assigneeEmail, which breaks visibility (isSubmissionVisible /
    // visibility.js both read workflow_tasks[].assigneeEmail at the top level).
    const flatTasks = taskList.map((t, idx) => extractTask(t, idx + 1));
    // Resolve the real prefill (access) link for any active workflow_assign_form
    // task — opens the target form pre-populated and submittable, per user.
    await enrichTasksWithPrefill(flatTasks, submissionId, profileId);
    applyResourceShareLinks(flatTasks, resourceShares, formId);
    for (const task of flatTasks) {
      if (task.taskId) task.accessLink = buildWorkflowTaskUrl(task, formId);
    }

    const activeFlat = flatTasks.find(t => t.status === 'ACTIVE' && t.assigneeEmail)
      || flatTasks.find(t => t.status === 'ACTIVE');
    const activeTask = taskList.find(t => String(t.id || '') === String(activeFlat?.taskId || ''))
      || taskList.find(t => String(t.status || '').toUpperCase() === 'ACTIVE');
    if (!activeTask) return { pendingApproverName: '', pendingApproverEmail: '', approvalUrl: '', workflowTasks: flatTasks };

    const props = activeTask.properties || {};
    const assigneeUser = props.assigneeUser || {};
    const recipients = Array.isArray(props.recipients) ? props.recipients : [];
    const firstRecipient = recipients[0] || {};

    const pendingApproverName = String(activeFlat?.assigneeName || assigneeUser.name || firstRecipient.name || '');
    const candidateEmail = String(activeFlat?.assigneeEmail || props.assigneeEmail || assigneeUser.email || firstRecipient.email || '');
    const pendingApproverEmail = candidateEmail.includes('@') ? candidateEmail : '';
    const approvalUrl = buildWorkflowTaskUrl(activeFlat, formId);

    return { pendingApproverName, pendingApproverEmail, approvalUrl, workflowTasks: flatTasks };
  } catch (err) {
    console.warn(`[poller] enrichWithWorkflow failed for ${submissionId} (instance ${workflowInstanceId}):`, err.message);
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
  } catch (err) {
    console.warn(`[poller] jf_approver_config lookup failed for form ${formId} level ${level}:`, err.message);
  }
  return { name: '', email: '' };
}

// ── Main poll cycle ───────────────────────────────────────────────────────────
// opts.quick: lightweight incremental pass — cached questions, only the latest
// submissions per form, shorter inter-form pause. Runs every POLL_QUICK_SECONDS
// so new/changed data lands in the DB within seconds; the full pass (every
// POLL_INTERVAL_MINUTES) still re-syncs everything.
async function pollOnce(opts = {}) {
  const quick = !!opts.quick;
  const profileId = opts.profileId || pollerProfileId();
  if (runningProfiles.has(profileId)) {
    if (!quick) console.log(`[poller] Previous poll still running for ${profileId} — skipping`);
    return;
  }
  runningProfiles.add(profileId);
  const start = Date.now();
  if (!quick) console.log(`[poller] Poll started for ${profileId}`);

  try {
    // 1. Fetch all enabled forms
    const forms = await fetchEnabledForms(profileId, quick);

    if (forms.length === 0) {
      console.log('[poller] No forms found');
      return;
    }

    // 2. Upsert form metadata into jf_forms (form creator via username field)
    for (const form of forms) {
      await pool.query(
        `INSERT INTO jf_forms (form_id, title, creator_username, status, created_at_jf, updated_at_jf, last_synced, profile_id)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         ON CONFLICT (form_id) DO UPDATE SET
           title=$2, creator_username=$3, status=$4, updated_at_jf=$6, last_synced=now(), profile_id=$7`,
        [
          String(form.id),
          String(form.title || ''),
          String(form.username || ''),
          String(form.status || ''),
          form.created_at ? new Date(form.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
          form.updated_at ? new Date(form.updated_at.replace(' ', 'T') + 'Z').toISOString() : null,
          profileId,
        ]
      ).catch(err => console.warn(`[poller] jf_forms upsert failed for ${form.id}:`, err.message));
      await upsertWorkspaceForm(profileId, form)
        .catch(err => console.warn(`[poller] team form upsert failed for ${form.id}:`, err.message));
    }

    let totalUpserted = 0;

    // 3. Process each form's submissions
    for (const form of forms) {
      const formId = String(form.id);
      const formTitle = String(form.title || '');

      // Fetch questions for field detection (cached — quick polls always reuse,
      // full polls refresh after QUESTIONS_TTL_MS)
      let detectedFields = null;
      const cachedQ = questionsCache.get(formId);
      if (cachedQ && (quick || Date.now() - cachedQ.at < QUESTIONS_TTL_MS)) {
        detectedFields = cachedQ.detectedFields;
      } else {
        try {
          const qData = await jotformFetch(`form/${formId}/questions`, { keyType: profileId });
          detectedFields = detectLevelFields(qData.content || {});
          questionsCache.set(formId, { detectedFields, at: Date.now() });
        } catch (err) {
          console.warn(`[poller] Could not fetch questions for form ${formId}:`, err.message);
          continue;
        }
      }

      // Fetch submissions — quick polls grab only the latest page (new
      // submissions + recent updates), full polls page until JotForm is done.
      let submissions = [];
      try {
        if (quick) {
          const subData = await jotformFetch(`form/${formId}/submissions`, {
            params: { limit: '10', offset: '0', orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
            keyType: profileId,
          });
          submissions = subData.content || [];
        } else {
          submissions = await fetchAllPages(`form/${formId}/submissions`, profileId, {
            orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1',
          });
        }
      } catch (err) {
        console.warn(`[poller] Could not fetch submissions for form ${formId}:`, err.message);
        continue;
      }

      // 4. Prepare each submission's mapped fields (synchronous, no I/O).
      const prepared = [];
      for (const raw of submissions) {
        const submissionId = String(raw.id || '');
        if (!submissionId || !/^\d+$/.test(submissionId)) continue;

        try {
          const answers = raw.answers || {};
          const get = (id) => id ? extractText(answers[id]?.answer) : '';

          const hasStatusSignal = detectedFields.levelFields.length > 0 || !!detectedFields.overallStatusFieldId;
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
          if (!hasStatusSignal && !raw.workflowStatus && !raw.workflowInstanceID && !raw.workflow_instance_id) {
            status = 'completed';
            currentLevel = maxLevel;
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

          prepared.push({
            raw, submissionId, levels, currentLevel, status, maxLevel,
            submittedBy, email, title, description, department, priority, amount,
            editLink, submissionDate, updatedDate, totalDays, allAnswers,
            workflowInstanceId: raw.workflowInstanceID || raw.workflow_instance_id,
            workflowStatus: raw.workflowStatus || '',
            // Enrichment results — filled by the parallel pass below.
            pendingApproverName: '', pendingApproverEmail: '', workflowTasks: [], approvalUrl: '',
          });
        } catch (err) {
          console.warn(`[poller] Failed to prepare submission ${submissionId}:`, err.message);
        }
      }

      // 5. Enrich every pending submission's workflow data IN PARALLEL (bounded).
      //    Previously this ran sequentially inside the loop — one blocking
      //    JotForm round-trip per pending submission.
      await pMapLimit(prepared, POLL_ENRICH_CONCURRENCY, async (p) => {
        // Enrich genuinely-active workflows only (instance exists AND workflowStatus
        // isn't finished/not-started). Rows we skip keep their existing enrichment —
        // the upsert below preserves workflow_tasks/pending_approver when empty — so
        // a finished workflow synced earlier isn't blanked every cycle.
        if ((p.workflowInstanceId || p.workflowStatus) && workflowIsActive(p.workflowStatus)) {
          const enriched = await enrichWithWorkflow(p.submissionId, p.workflowInstanceId, formId, profileId);
          p.pendingApproverName = enriched.pendingApproverName;
          p.pendingApproverEmail = enriched.pendingApproverEmail;
          p.approvalUrl = enriched.approvalUrl;
          p.workflowTasks = enriched.workflowTasks;
        }
        // Fallback: jf_approver_config if workflow gave us nothing.
        if (!p.pendingApproverEmail && p.status === 'pending') {
          const fallback = await getFallbackApprover(formId, p.currentLevel);
          p.pendingApproverName = fallback.name;
          p.pendingApproverEmail = fallback.email;
        }
      });

      // 5b. Authoritative status from the workflow engine (instance status +
      //     task list), overriding the form-field heuristic. Finished workflows
      //     skip enrichment above (workflowTasks empty), but workflowStatus from
      //     the bulk API still resolves completion. Clear the pending approver on
      //     terminal states so a finished row never lingers in someone's queue.
      for (const p of prepared) {
        const derived = deriveWorkflowStatus(p.workflowStatus, p.workflowTasks);
        if (derived) {
          p.status = derived;
          if (derived === 'completed') p.currentLevel = p.maxLevel;
          if (derived !== 'pending') { p.pendingApproverName = ''; p.pendingApproverEmail = ''; }
        }
      }

      // Small pause before moving to the next form — prevents burst API calls
      // across many forms from triggering JotForm's own rate limiter.
      if (!quick) await new Promise(r => setTimeout(r, INTER_FORM_DELAY_MS));

      // 6. Upsert each prepared submission.
      for (const p of prepared) {
        try {
          const levelHistory = p.levels.map(l => {
            const matchingTask = p.workflowTasks.find(t => t.level === l.id);
            const approverEmail = parseEmailFromActionText(l.approver) ||
              (matchingTask
                ? (String(matchingTask.status || '').toUpperCase() === 'COMPLETED'
                    ? (matchingTask.submittedByEmail || matchingTask.assigneeEmail)
                    : matchingTask.assigneeEmail)
                : (l.id === p.currentLevel ? p.pendingApproverEmail : ''));
            return {
              level: l.id, status: l.status || 'pending',
              approver: l.approver || p.pendingApproverName || '',
              approverEmail: approverEmail || '',
              date: l.date || '',
            };
          });

          const genericStatus = p.status === 'completed' ? 'Completed' :
            p.status === 'rejected' ? 'Rejected' :
            p.levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

          await pool.query(
            `INSERT INTO jf_submissions (
              jotform_submission_id, form_id, form_title, title, description,
              submitted_by, submitter_name, submitter_email, department,
              submission_date, current_level, status, priority, amount,
              approver_name, approver_email, pending_approver_name, pending_approver_email,
              jotform_status, answers, workflow_tasks, level_history, edit_link,
              raw_data, created_at_jf, updated_at_jf, days_at_level, total_days,
              last_synced, needs_sync, approval_url, profile_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now(),$29,$30,$31)
            ON CONFLICT (jotform_submission_id) DO UPDATE SET
              profile_id=$31,
              form_id=$2, form_title=$3, title=$4, description=$5,
              submitted_by=$6, submitter_name=$7, submitter_email=$8, department=$9,
              submission_date=$10, current_level=$11, status=$12, priority=$13, amount=$14,
              approver_name = CASE WHEN $15 = '' THEN jf_submissions.approver_name ELSE $15 END,
              approver_email = CASE WHEN $16 = '' THEN jf_submissions.approver_email ELSE $16 END,
              pending_approver_name = CASE WHEN $12 IN ('completed','rejected') THEN NULL WHEN $17 = '' THEN jf_submissions.pending_approver_name ELSE $17 END,
              pending_approver_email = CASE WHEN $12 IN ('completed','rejected') THEN NULL WHEN $18 = '' THEN jf_submissions.pending_approver_email ELSE $18 END,
              jotform_status=$19, answers=$20,
              workflow_tasks = CASE WHEN $21::jsonb = '[]'::jsonb THEN jf_submissions.workflow_tasks ELSE ${mergeWorkflowTasksSql('$21')} END,
              level_history=$22, edit_link=$23,
              raw_data=$24, created_at_jf=$25, updated_at_jf=$26, days_at_level=$27, total_days=$28,
              last_synced=now(), needs_sync=$29,
              approval_url = CASE
                WHEN EXISTS (
                  SELECT 1 FROM jsonb_array_elements($21::jsonb) t
                  WHERE t->>'status' = 'ACTIVE' AND t->>'type' = 'workflow_assign_task'
                    AND COALESCE(t->>'internalFormID','') = ''
                ) THEN NULL
                WHEN EXISTS (
                  SELECT 1 FROM jsonb_array_elements($21::jsonb) t
                  WHERE t->>'status' = 'ACTIVE' AND t->>'type' = 'workflow_assign_task'
                ) THEN CASE
                  WHEN $30 LIKE '%/share/%' OR $30 LIKE '%/approval-form/%' THEN $30
                  WHEN jf_submissions.approval_url LIKE '%/share/%' OR jf_submissions.approval_url LIKE '%/approval-form/%' THEN jf_submissions.approval_url
                  ELSE NULL
                END
                ELSE COALESCE($30, jf_submissions.approval_url)
              END`,
            [
              p.submissionId, formId, formTitle, p.title, p.description,
              p.submittedBy, p.submittedBy, p.email, p.department,
              p.submissionDate.toISOString(), Math.min(p.currentLevel, p.maxLevel), p.status, p.priority, p.amount,
              p.pendingApproverName || p.levels.find(l => l.approver)?.approver || '',
              p.pendingApproverEmail,
              p.pendingApproverName, p.pendingApproverEmail,
              genericStatus,
              JSON.stringify(p.allAnswers), JSON.stringify(p.workflowTasks),
              JSON.stringify(levelHistory), p.editLink,
              JSON.stringify({ ...p.raw, _mapped: { levels: p.levels, email: p.email, amount: p.amount } }),
              p.submissionDate.toISOString(), p.updatedDate?.toISOString() || null,
              p.totalDays, p.totalDays,
              false, p.approvalUrl || null, profileId,
            ]
          );
          totalUpserted++;
          await upsertWorkspaceLinks({
            profileId,
            submissionId: p.submissionId,
            formId,
            workflowTasks: p.workflowTasks,
            approvalUrl: p.approvalUrl,
          }).catch(err => console.warn(`[poller] workspace URL upsert failed for ${p.submissionId}:`, err.message));
          // Log task assignments to email_logs
          if (p.workflowTasks.length > 0) {
            await upsertEmailLogs(p.submissionId, formId, formTitle, p.workflowTasks, profileId);
            // Generate magic-link tokens for ACTIVE assign_task steps
            const { getOrCreateToken } = require('./task-token');
            for (const t of p.workflowTasks) {
              if (t.type === 'workflow_assign_task' && t.status === 'ACTIVE' && t.assigneeEmail && t.taskId) {
                await getOrCreateToken(p.submissionId, t.taskId, t.assigneeEmail).catch(() => {});
              }
            }
          }
        } catch (err) {
          console.warn(`[poller] Failed to upsert submission ${p.submissionId}:`, err.message);
        }
      }
    }

    // 6. Harvest /share/{token} links from sent emails for non-assign-form tasks whose
    // accessLink the workflow API doesn't expose (any assignee other than the
    // API key's own account). Throttled internally; never fails the poll.
    // Skipped on quick polls to keep them fast.
    if (!quick) {
      try {
        const { harvestEmailLinks } = require('./email-link-harvester');
        await harvestEmailLinks({ profileId });
      } catch (err) {
        console.warn('[poller] email link harvest failed:', err.message);
      }
      try {
        const { syncSystemLogs } = require('./system-log-sync');
        await syncSystemLogs({ profileId });
      } catch (err) {
        console.warn('[poller] system-log sync failed:', err.message);
      }
      try {
        const { syncEnterpriseHistory } = require('./history-sync');
        await syncEnterpriseHistory({ profileId });
      } catch (err) {
        console.warn('[poller] enterprise-history sync failed:', err.message);
      }
      try {
        const { syncAccountHistory } = require('./account-history-sync');
        await syncAccountHistory({ profileId });
      } catch (err) {
        console.warn('[poller] account-history sync failed:', err.message);
      }
      try {
        const { runEmailArchive } = require('./email-archiver');
        await runEmailArchive({ profileId });
      } catch (err) {
        console.warn('[poller] email archive failed:', err.message);
      }
      if (env.MAIL_SENDER_ENABLED) {
        try {
          const { syncJotformMailSender } = require('./jotform-mail-sender');
          const result = await syncJotformMailSender({ profileId });
          if (result.synced > 0) console.log(`[poller] mail sender synced ${result.synced} sent email(s)`);
        } catch (err) {
          console.warn('[poller] mail sender sync failed:', err.message);
        }
      }
      try {
        const { runUserSync } = require('./user-sync');
        await runUserSync({ profileId });
      } catch (err) {
        console.warn('[poller] user sync failed:', err.message);
      }
    }

    // 7. Broadcast to all connected frontend clients
    emitToAll('submissions:updated', { polledAt: new Date().toISOString(), count: totalUpserted });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[poller] ${quick ? 'Quick poll' : 'Poll'} complete — ${totalUpserted} submissions upserted in ${elapsed}s`);
  } catch (err) {
    console.error('[poller] Poll failed:', err.message);
  } finally {
    runningProfiles.delete(profileId);
  }
}

// ── Start the poller ──────────────────────────────────────────────────────────
function startPoller() {
  const intervalMs = (env.POLL_INTERVAL_MINUTES || 2) * 60 * 1000;
  const quickMs = (env.POLL_QUICK_SECONDS || 0) * 1000;
  console.log(`[poller] Starting — full poll every ${env.POLL_INTERVAL_MINUTES || 2} min` +
    (quickMs ? `, quick poll every ${env.POLL_QUICK_SECONDS}s` : ''));

  const run = async (quick = false) => {
    const profileIds = await pollerProfileIds();
    for (const profileId of profileIds) {
      if (!resolveApiKey(profileId)) {
        console.warn(`[poller] Skipping "${profileId}" — JotForm API key is not set`);
        continue;
      }
      await pollOnce({ quick, profileId });
    }
  };

  // Run a quick pass immediately so recent assigned tasks land before the
  // heavier full sweep starts blocking the poller.
  run(true).catch(err => console.error('[poller] Initial poll error:', err.message));

  // Then on interval
  pollTimer = setInterval(() => {
    run(false).catch(err => console.error('[poller] Interval poll error:', err.message));
  }, intervalMs);

  // Lightweight incremental syncs between full polls. Each profile has its own
  // lock, so one large workspace does not block quick refresh for another.
  if (quickMs > 0) {
    quickTimer = setInterval(() => {
      run(true).catch(err => console.error('[poller] Quick poll error:', err.message));
    }, quickMs);
  }
}

function stopPoller() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (quickTimer) { clearInterval(quickTimer); quickTimer = null; }
}

module.exports = { startPoller, stopPoller, pollOnce };
