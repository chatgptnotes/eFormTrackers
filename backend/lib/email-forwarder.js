const nodemailer = require('nodemailer');
const pool = require('../db/pool');
const env = require('../config/env');
const {
  enrichArchivedEmailRecord,
  normalizeRecipientEmails,
  primaryRecipientEmail,
} = require('./email-ingestion');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.EMAIL_FORWARD_TO || !env.EMAIL_FORWARD_ENABLED) return null;
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderForwardHtml(row) {
  const submitted = row.sent_at ? new Date(row.sent_at).toLocaleString() : '';
  const meta = [
    ['Profile', row.profile_id],
    ['Form', row.form_title || row.form_id],
    ['Submission', row.submission_id],
    ['Email ID', row.email_id],
    ['Type', row.email_type],
    ['To', row.to_addr],
    ['From', row.from_addr],
    ['Sent', submitted],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0;color:#111827">${escapeHtml(value)}</td></tr>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-weight:700;font-size:16px;margin-bottom:12px">Forwarded JotForm email</div>
      <table style="border-collapse:collapse;font-size:14px">${meta}</table>
    </div>
    <div style="border-top:1px solid #e5e7eb;padding-top:16px">
      ${row.body_html || `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(row.preview || '')}</pre>`}
    </div>
  </body>
</html>`;
}

async function upsertForwardLog(row, targetMailbox, status, opts = {}) {
  const attemptedAt = opts.attemptedAt || new Date();
  const deliveredAt = opts.deliveredAt || null;
  const deliveryError = opts.deliveryError || '';
  await pool.query(
    `INSERT INTO jf_email_forward_log
       (profile_id, email_id, target_mailbox, status, method,
        submission_id, form_id, form_title, email_type,
        recipient_email, recipient_emails, recipient_user_jf_id, recipient_user_name,
        subject, body_html, preview, action_links, sent_at,
        attempted_at, delivered_at, delivery_error, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),now())
     ON CONFLICT (profile_id, email_id, target_mailbox)
     DO UPDATE SET
       status = EXCLUDED.status,
       method = EXCLUDED.method,
       submission_id = EXCLUDED.submission_id,
       form_id = EXCLUDED.form_id,
       form_title = EXCLUDED.form_title,
       email_type = EXCLUDED.email_type,
       recipient_email = EXCLUDED.recipient_email,
       recipient_emails = EXCLUDED.recipient_emails,
       recipient_user_jf_id = EXCLUDED.recipient_user_jf_id,
       recipient_user_name = EXCLUDED.recipient_user_name,
       subject = EXCLUDED.subject,
       body_html = EXCLUDED.body_html,
       preview = EXCLUDED.preview,
       action_links = EXCLUDED.action_links,
       sent_at = EXCLUDED.sent_at,
       attempted_at = EXCLUDED.attempted_at,
       delivered_at = EXCLUDED.delivered_at,
       delivery_error = EXCLUDED.delivery_error,
       updated_at = now()`,
    [
      row.profile_id,
      row.email_id,
      targetMailbox,
      status,
      'smtp_forward',
      row.submission_id || '',
      row.form_id || '',
      row.form_title || '',
      row.email_type || '',
      row.recipient_email || '',
      JSON.stringify(row.recipient_emails || []),
      row.recipient_user_jf_id || '',
      row.recipient_user_name || '',
      row.subject || '',
      row.body_html || '',
      row.preview || '',
      JSON.stringify(row.action_links || []),
      row.sent_at || null,
      attemptedAt,
      deliveredAt,
      deliveryError,
    ],
  );
}

async function forwardArchivedEmails(opts = {}) {
  if (!env.EMAIL_FORWARD_ENABLED) return { skipped: true, reason: 'disabled' };
  const to = env.EMAIL_FORWARD_TO;
  if (!to) return { skipped: true, reason: 'missing_target' };

  const profileId = opts.profileId || 'gdmo';
  const limit = Math.min(parseInt(opts.limit || '25', 10) || 25, 100);
  const transport = getTransporter();

  const { rows } = await pool.query(
    `SELECT profile_id, email_id, submission_id, form_id, form_title, email_type,
            recipient_email, recipient_emails, recipient_user_jf_id, recipient_user_name,
            to_addr, from_addr, subject, body_html, preview, action_links, sent_at
       FROM jf_email_archive
      WHERE profile_id = $1 AND forwarded_at IS NULL
      ORDER BY sent_at ASC NULLS LAST, created_at ASC
      LIMIT $2`,
    [profileId, limit],
  );

  let forwarded = 0;
  let queued = 0;
  for (const row of rows) {
    const enriched = await enrichArchivedEmailRecord({
      profileId: row.profile_id,
      submissionId: row.submission_id,
      formId: row.form_id,
      toAddr: row.to_addr,
      bodyHtml: row.body_html,
    });
    const subject = row.subject ? `[JotForm] ${row.subject}` : `[JotForm] ${row.form_title || row.form_id || 'Workflow Email'}`;
    const recipientEmail = row.recipient_email || enriched.recipientEmail || primaryRecipientEmail(row.to_addr);
    const recipientEmails = (row.recipient_emails && Array.isArray(row.recipient_emails))
      ? row.recipient_emails
      : (enriched.recipientEmails || normalizeRecipientEmails(row.to_addr));
    const recipientUser = row.recipient_user_jf_id ? {
      jf_id: row.recipient_user_jf_id,
      name: row.recipient_user_name || '',
    } : enriched.recipientUser;
    const actionLinks = (row.action_links && Array.isArray(row.action_links) && row.action_links.length)
      ? row.action_links
      : (enriched.actionLinks || []);
    if (!transport) {
      await upsertForwardLog({
        ...row,
        recipient_email: recipientEmail,
        recipient_emails: recipientEmails,
        recipient_user_jf_id: recipientUser?.jf_id || '',
        recipient_user_name: recipientUser?.name || '',
        action_links: actionLinks,
      }, to, 'queued', {
        attemptedAt: new Date(),
        deliveryError: 'SMTP not configured',
      });
      queued += 1;
      continue;
    }

    try {
      const attemptedAt = new Date();
      await transport.sendMail({
        from: env.EMAIL_FORWARD_FROM || env.SMTP_USER,
        to,
        subject,
        text: [
          'Forwarded JotForm email',
          `Profile: ${row.profile_id || ''}`,
          `Form: ${row.form_title || row.form_id || ''}`,
          `Submission: ${row.submission_id || ''}`,
          `Email ID: ${row.email_id || ''}`,
          `Type: ${row.email_type || ''}`,
          `To: ${row.to_addr || ''}`,
          `From: ${row.from_addr || ''}`,
          `Sent: ${row.sent_at ? new Date(row.sent_at).toISOString() : ''}`,
          '',
          row.preview || '',
        ].join('\n'),
        html: renderForwardHtml(row),
      });

      await upsertForwardLog({
        ...row,
        recipient_email: recipientEmail,
        recipient_emails: recipientEmails,
        recipient_user_jf_id: recipientUser?.jf_id || '',
        recipient_user_name: recipientUser?.name || '',
        action_links: actionLinks,
      }, to, 'sent', {
        attemptedAt,
        deliveredAt: new Date(),
      });
      await pool.query(
        `UPDATE jf_email_archive
            SET forwarded_at = now(),
                forwarded_to = $3,
                forward_error = ''
          WHERE profile_id = $1 AND email_id = $2`,
        [row.profile_id, row.email_id, to],
      );
      forwarded += 1;
    } catch (err) {
      await upsertForwardLog({
        ...row,
        recipient_email: recipientEmail,
        recipient_emails: recipientEmails,
        recipient_user_jf_id: recipientUser?.jf_id || '',
        recipient_user_name: recipientUser?.name || '',
        action_links: actionLinks,
      }, to, 'failed', {
        attemptedAt: new Date(),
        deliveryError: String(err.message || err),
      });
      await pool.query(
        `UPDATE jf_email_archive
            SET forward_error = $3
          WHERE profile_id = $1 AND email_id = $2`,
        [row.profile_id, row.email_id, String(err.message || err)],
      );
    }
  }

  return { forwarded, queued, scanned: rows.length, to };
}

module.exports = { forwardArchivedEmails };
