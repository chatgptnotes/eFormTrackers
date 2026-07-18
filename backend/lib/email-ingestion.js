const pool = require('../db/pool');
const { extractActionLinks } = require('./email-parse');
const { normalizeTaskLink } = require('./jotform-link');
const { resolvePrefillUrl } = require('./prefill');
const { upsertWorkspaceLinks } = require('./workspace-links');

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const recipientUserCache = new Map();

function normalizeRecipientEmails(value) {
  const raw = String(value || '');
  const matches = raw.match(EMAIL_RE) || [];
  const out = [...new Set(matches.map(e => e.trim().toLowerCase()).filter(Boolean))];
  if (out.length) return out;
  const trimmed = raw.trim().toLowerCase();
  return trimmed ? [trimmed] : [];
}

function primaryRecipientEmail(value) {
  return normalizeRecipientEmails(value)[0] || '';
}

async function resolveRecipientUser(profileId, recipientEmail) {
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!email) return null;
  const cacheKey = `${profileId}:${email}`;
  if (recipientUserCache.has(cacheKey)) return recipientUserCache.get(cacheKey);

  const { rows } = await pool.query(
    `SELECT jf_id, email, name, username, account_type
       FROM jf_users
      WHERE profile_id = $1
        AND lower(email) = $2
      LIMIT 1`,
    [profileId, email],
  );
  const user = rows[0] ? {
    jf_id: rows[0].jf_id,
    email: rows[0].email || email,
    name: rows[0].name || rows[0].username || '',
    username: rows[0].username || '',
    account_type: rows[0].account_type || '',
  } : null;
  recipientUserCache.set(cacheKey, user);
  return user;
}

function dedupeLinks(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const url = String(item?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(item);
  }
  return out;
}

function buildLinkRecord({
  url,
  label,
  type,
  source,
  taskId = '',
  taskName = '',
  taskType = '',
  formId = '',
  submissionId = '',
}) {
  const parsed = normalizeTaskLink(url, {
    taskId,
    internalFormID: formId,
    type: taskType,
  });
  return {
    url: parsed.normalizedUrl || url,
    label: label || (type === 'fill' ? 'Fill Form' : type === 'approve' ? 'Approve' : 'Open Task'),
    type: type || parsed.linkType || 'task',
    source,
    taskId: parsed.taskId || taskId || '',
    taskName,
    taskType,
    formId: parsed.taskFormId || formId || '',
    submissionId,
  };
}

function linksFromBody(bodyHtml) {
  return extractActionLinks(bodyHtml).map(link => ({
    url: link.url,
    label: link.label,
    type: link.type,
    source: 'email-body',
  }));
}

async function resolveDbActionLinks({ profileId, submissionId, recipientEmail, formId }) {
  const links = [];
  const recipient = String(recipientEmail || '').trim().toLowerCase();
  if (!submissionId) return links;

  try {
    const { rows: emailRows } = await pool.query(
      `SELECT task_id, task_name, task_type, assignee_email, access_link, form_id
         FROM email_logs
        WHERE profile_id = $1
          AND submission_id = $2`,
      [profileId, String(submissionId)],
    );

    for (const row of emailRows) {
      const assignee = String(row.assignee_email || '').trim().toLowerCase();
      if (recipient && assignee && recipient !== assignee && !recipient.includes(assignee) && !assignee.includes(recipient)) {
        continue;
      }
      const url = String(row.access_link || '').trim();
      if (!url) continue;
      const type = String(row.task_type || '').includes('workflow_assign_form')
        ? 'fill'
        : String(row.task_type || '').toLowerCase().includes('approval')
          ? 'approve'
          : 'task';
      links.push(buildLinkRecord({
        url,
        label: row.task_name || (type === 'fill' ? 'Fill Form' : 'Open Task'),
        type,
        source: 'email-log',
        taskId: row.task_id,
        taskName: row.task_name,
        taskType: row.task_type,
        formId: row.form_id || formId || '',
        submissionId,
      }));
    }

    if (links.length > 0) return dedupeLinks(links);

    const { rows: subRows } = await pool.query(
      `SELECT form_id, approval_url, workflow_tasks
         FROM jf_submissions
        WHERE profile_id = $1
          AND jotform_submission_id = $2
        LIMIT 1`,
      [profileId, String(submissionId)],
    );
    const submission = subRows[0];
    const tasks = Array.isArray(submission?.workflow_tasks) ? submission.workflow_tasks : [];
    const activeTasks = tasks.filter(t => ['ACTIVE', 'PENDING'].includes(String(t.status).toUpperCase()));

    for (const task of activeTasks) {
      const taskEmail = String(task.assigneeEmail || '').trim().toLowerCase();
      if (recipient && taskEmail && recipient !== taskEmail && !recipient.includes(taskEmail) && !taskEmail.includes(recipient)) {
        continue;
      }

      let url = String(task.accessLink || '').trim();
      const taskType = String(task.type || '').trim();
      if (!url && taskType === 'workflow_assign_form') {
        try {
          url = await resolvePrefillUrl({
            formId: task.internalFormID || submission?.form_id || formId || '',
            submissionId,
            taskId: task.taskId || '',
            profileId,
          });
        } catch {
          url = '';
        }
      }
      if (!url && submission?.approval_url) {
        url = String(submission.approval_url || '').trim();
      }
      if (!url) continue;

      links.push(buildLinkRecord({
        url,
        label: task.name || (taskType === 'workflow_assign_form' ? 'Fill Form' : 'Open Task'),
        type: taskType === 'workflow_assign_form'
          ? 'fill'
          : (taskType.toLowerCase().includes('approval') ? 'approve' : 'task'),
        source: 'submission-workflow',
        taskId: task.taskId || '',
        taskName: task.name || '',
        taskType,
        formId: task.internalFormID || submission?.form_id || formId || '',
        submissionId,
      }));
    }
  } catch (err) {
    console.warn('[email-ingestion] resolveDbActionLinks failed:', err.message);
  }

  return dedupeLinks(links);
}

async function enrichArchivedEmailRecord({
  profileId,
  submissionId,
  formId,
  toAddr,
  bodyHtml,
}) {
  const recipientEmails = normalizeRecipientEmails(toAddr);
  const recipientEmail = recipientEmails[0] || '';
  const recipientUser = await resolveRecipientUser(profileId, recipientEmail);
  let dbLinks = [];
  try {
    dbLinks = await resolveDbActionLinks({ profileId, submissionId, recipientEmail, formId });
  } catch (err) {
    console.warn('[email-ingestion] enrichArchivedEmailRecord db-link resolution failed:', err.message);
  }
  const actionLinks = dedupeLinks([
    ...linksFromBody(bodyHtml),
    ...dbLinks,
  ]);

  return {
    recipientEmail,
    recipientEmails,
    recipientUser,
    actionLinks,
  };
}

function recipientUserMatchesEmail(user, email) {
  return String(user?.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase();
}

async function upsertAllowlistUsersFromEmail({
  profileId,
  emailId,
  toAddr,
  recipientEmails,
  recipientUser,
  sentAt,
}) {
  const normalized = [
    ...normalizeRecipientEmails(toAddr),
    ...(Array.isArray(recipientEmails) ? recipientEmails : []),
  ]
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set(normalized)];
  if (!profileId || emails.length === 0) return { saved: 0 };

  const seenAt = sentAt ? new Date(sentAt) : new Date();
  const seenAtValue = isNaN(seenAt) ? new Date() : seenAt;
  let saved = 0;

  for (const email of emails) {
    const user = recipientUserMatchesEmail(recipientUser, email)
      ? recipientUser
      : await resolveRecipientUser(profileId, email);
    const username = String(user?.username || user?.name || '').trim();
    const name = String(user?.name || user?.username || '').trim();
    const jfId = String(user?.jf_id || '').trim();

    try {
      const result = await pool.query(
        `INSERT INTO allowlist_user
           (profile_id, username, mailid, name, jf_id, source,
            first_seen_at, last_seen_at, last_email_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'jotform_email',$6,$6,$7,now(),now())
         ON CONFLICT (profile_id, mailid) DO UPDATE SET
           username = COALESCE(NULLIF(EXCLUDED.username, ''), allowlist_user.username),
           name = COALESCE(NULLIF(EXCLUDED.name, ''), allowlist_user.name),
           jf_id = COALESCE(NULLIF(EXCLUDED.jf_id, ''), allowlist_user.jf_id),
           source = EXCLUDED.source,
           first_seen_at = LEAST(
             COALESCE(allowlist_user.first_seen_at, EXCLUDED.first_seen_at),
             COALESCE(EXCLUDED.first_seen_at, allowlist_user.first_seen_at)
           ),
           last_seen_at = GREATEST(
             COALESCE(allowlist_user.last_seen_at, EXCLUDED.last_seen_at),
             COALESCE(EXCLUDED.last_seen_at, allowlist_user.last_seen_at)
           ),
           last_email_id = COALESCE(NULLIF(EXCLUDED.last_email_id, ''), allowlist_user.last_email_id),
           updated_at = now()`,
        [
          profileId,
          username,
          email,
          name,
          jfId,
          seenAtValue,
          String(emailId || ''),
        ],
      );
      saved += result.rowCount || 0;
    } catch (err) {
      console.warn('[email-ingestion] allowlist_user upsert failed:', err.message);
      return { saved };
    }
  }

  return { saved };
}

function taskMatchesRecipient(task, recipientEmail) {
  const recipient = String(recipientEmail || '').trim().toLowerCase();
  const assignee = String(task.assignee_email || task.assigneeEmail || '').trim().toLowerCase();
  return !!recipient && !!assignee && assignee === recipient;
}

function linkScoreForTask(link, task) {
  const url = String(link?.url || '').toLowerCase();
  const type = String(link?.type || '').toLowerCase();
  const taskType = String(task.task_type || task.type || '').toLowerCase();
  if (!url || type === 'reject') return -1;
  const exactTask = link.taskId && task.task_id && String(link.taskId) === String(task.task_id);
  const exactBoost = exactTask ? 30 : 0;
  if (url.includes('/inbox/')) return exactTask ? 45 : 5;
  if (taskType === 'workflow_assign_form') {
    if (type === 'fill' || url.includes('/prefill/') || url.includes('workflowassignformtask')) return 80 + exactBoost;
    return -1;
  }
  if (taskType === 'workflow_assign_task') {
    if (url.includes('/approval-form/') || url.includes('/share/')) return 70 + exactBoost;
    if (type === 'task') return 55 + exactBoost;
    return -1;
  }
  if (taskType.includes('approval')) {
    if (url.includes('/approval-form/') || url.includes('/share/')) return 60 + exactBoost;
    if (type === 'approve' || type === 'task') return 50 + exactBoost;
    return -1;
  }
  return type === 'task' || type === 'fill' || url.includes('/share/') ? 40 + exactBoost : -1;
}

function pickActionLinkForTask(actionLinks, task) {
  return (actionLinks || [])
    .map(link => ({ link, score: linkScoreForTask(link, task) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.link || null;
}

async function loadSubmissionTasks(profileId, submissionId, recipientEmail) {
  const { rows } = await pool.query(
    `SELECT t->>'taskId' AS task_id,
            t->>'name' AS task_name,
            t->>'type' AS task_type,
            t->>'assigneeEmail' AS assignee_email,
            t->>'internalFormID' AS task_form_id,
            t->>'status' AS task_status,
            s.form_id AS parent_form_id
       FROM jf_submissions s,
            jsonb_array_elements(
              CASE WHEN jsonb_typeof(s.workflow_tasks) = 'array' THEN s.workflow_tasks ELSE '[]'::jsonb END
            ) t
      WHERE s.profile_id = $1
        AND s.jotform_submission_id = $2`,
    [profileId, String(submissionId)],
  );
  return rows.filter(row => row.task_id && taskMatchesRecipient(row, recipientEmail));
}

async function loadEmailLogTasks(profileId, submissionId, recipientEmail) {
  const { rows } = await pool.query(
    `SELECT task_id, task_name, task_type, assignee_email, form_id AS parent_form_id,
            form_id AS task_form_id, task_status
       FROM email_logs
      WHERE profile_id = $1
        AND submission_id = $2`,
    [profileId, String(submissionId)],
  );
  return rows.filter(row => row.task_id && taskMatchesRecipient(row, recipientEmail));
}

async function persistArchivedEmailActionLinks({
  profileId,
  submissionId,
  formId,
  recipientEmail,
  actionLinks,
}) {
  if (!profileId || !submissionId || !Array.isArray(actionLinks) || actionLinks.length === 0) {
    return { updatedEmailLogs: 0, updatedSubmissionTasks: 0 };
  }

  const submissionTasks = await loadSubmissionTasks(profileId, submissionId, recipientEmail);
  const emailLogTasks = await loadEmailLogTasks(profileId, submissionId, recipientEmail);
  const byId = new Map();
  for (const task of [...submissionTasks, ...emailLogTasks]) {
    if (!byId.has(String(task.task_id))) byId.set(String(task.task_id), task);
  }

  let updatedEmailLogs = 0;
  let updatedSubmissionTasks = 0;
  for (const task of byId.values()) {
    const picked = pickActionLinkForTask(actionLinks, task);
    if (!picked) continue;
    const link = buildLinkRecord({
      ...picked,
      source: picked.source || 'email-archive',
      taskId: task.task_id,
      taskName: task.task_name || '',
      taskType: task.task_type || '',
      formId: task.task_form_id || task.parent_form_id || formId || '',
      submissionId,
    });
    const url = String(link.url || '').trim();
    if (!url) continue;

    const emailLog = await pool.query(
      `UPDATE email_logs
          SET access_link = $4, updated_at = now()
        WHERE profile_id = $1
          AND submission_id = $2
          AND task_id = $3
          AND COALESCE(access_link, '') <> $4`,
      [profileId, String(submissionId), String(task.task_id), url],
    );
    updatedEmailLogs += emailLog.rowCount || 0;

    const active = ['ACTIVE', 'PENDING'].includes(String(task.task_status || '').toUpperCase());
    const submission = await pool.query(
      `UPDATE jf_submissions
          SET workflow_tasks = (
                SELECT jsonb_agg(
                  CASE WHEN t->>'taskId' = $2
                    THEN jsonb_set(t, '{accessLink}', to_jsonb($3::text), true)
                    ELSE t
                  END
                )
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(workflow_tasks) = 'array' THEN workflow_tasks ELSE '[]'::jsonb END
                ) t
              ),
              approval_url = CASE WHEN $4::boolean THEN $3 ELSE approval_url END
        WHERE profile_id = $1
          AND jotform_submission_id = $5
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(workflow_tasks) = 'array' THEN workflow_tasks ELSE '[]'::jsonb END
            ) t WHERE t->>'taskId' = $2 AND COALESCE(t->>'accessLink', '') <> $3
          )`,
      [profileId, String(task.task_id), url, active, String(submissionId)],
    );
    updatedSubmissionTasks += submission.rowCount || 0;

    await upsertWorkspaceLinks({
      profileId,
      submissionId,
      formId: task.parent_form_id || formId,
      workflowTasks: [{
        taskId: task.task_id,
        name: task.task_name,
        type: task.task_type,
        status: task.task_status,
        assigneeEmail: task.assignee_email,
        internalFormID: task.task_form_id,
        accessLink: url,
      }],
      approvalUrl: active ? url : '',
    }).catch(err => console.warn(`[email-ingestion] workspace task URL upsert failed: ${err.message}`));
  }

  return { updatedEmailLogs, updatedSubmissionTasks };
}

async function backfillArchivedEmailActionLinks({ profileId, limit = 500 } = {}) {
  if (!profileId) return { processed: 0, updatedEmailLogs: 0, updatedSubmissionTasks: 0 };
  const { rows } = await pool.query(
    `SELECT profile_id, email_id, submission_id, form_id, to_addr, body_html,
            recipient_email, recipient_emails, action_links, sent_at
       FROM jf_email_archive
      WHERE profile_id = $1
        AND COALESCE(submission_id, '') <> ''
      ORDER BY sent_at DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [profileId, limit],
  );

  let updatedEmailLogs = 0;
  let updatedSubmissionTasks = 0;
  for (const row of rows) {
    const existingLinks = Array.isArray(row.action_links) ? row.action_links : [];
    const enriched = await enrichArchivedEmailRecord({
      profileId,
      submissionId: row.submission_id,
      formId: row.form_id,
      toAddr: row.to_addr || row.recipient_email || '',
      bodyHtml: row.body_html || '',
    });
    const actionLinks = dedupeLinks([...(enriched.actionLinks || []), ...existingLinks]);
    await pool.query(
      `UPDATE jf_email_archive
          SET recipient_email = COALESCE(NULLIF($3, ''), recipient_email),
              recipient_emails = $4::jsonb,
              recipient_user_jf_id = COALESCE(NULLIF($5, ''), recipient_user_jf_id),
              recipient_user_name = COALESCE(NULLIF($6, ''), recipient_user_name),
              action_links = $7::jsonb
        WHERE profile_id = $1 AND email_id = $2`,
      [
        row.profile_id,
        row.email_id,
        enriched.recipientEmail || row.recipient_email || '',
        JSON.stringify(enriched.recipientEmails || []),
        enriched.recipientUser?.jf_id || '',
        enriched.recipientUser?.name || '',
        JSON.stringify(actionLinks),
      ],
    );
    await upsertAllowlistUsersFromEmail({
      profileId: row.profile_id,
      emailId: row.email_id,
      toAddr: row.to_addr || row.recipient_email || '',
      recipientEmails: enriched.recipientEmails || row.recipient_emails || [],
      recipientUser: enriched.recipientUser,
      sentAt: row.sent_at,
    });
    const persisted = await persistArchivedEmailActionLinks({
      profileId: row.profile_id,
      submissionId: row.submission_id,
      formId: row.form_id,
      recipientEmail: enriched.recipientEmail || row.recipient_email || '',
      actionLinks,
    });
    updatedEmailLogs += persisted.updatedEmailLogs;
    updatedSubmissionTasks += persisted.updatedSubmissionTasks;
  }

  return { processed: rows.length, updatedEmailLogs, updatedSubmissionTasks };
}

module.exports = {
  normalizeRecipientEmails,
  primaryRecipientEmail,
  resolveRecipientUser,
  dedupeLinks,
  buildLinkRecord,
  linksFromBody,
  resolveDbActionLinks,
  enrichArchivedEmailRecord,
  upsertAllowlistUsersFromEmail,
  persistArchivedEmailActionLinks,
  backfillArchivedEmailActionLinks,
};
