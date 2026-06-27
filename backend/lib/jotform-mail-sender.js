const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const pool = require('../db/pool');
const env = require('../config/env');
const { extractActionLinks, htmlToPreview } = require('./email-parse');
const { getDefaultProfile } = require('./profiles');

let isRunning = false;

function asInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toJson(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Set) return Array.from(value).map(toJson);
  if (value instanceof Map) {
    const out = {};
    for (const [key, item] of value.entries()) out[key] = toJson(item);
    return out;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJson(item);
    return out;
  }
  return value;
}

function normalizeAddressList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.value)) return value.value;
  return [];
}

function formatOneAddress(addr) {
  const address = String(addr?.address || '').trim();
  const name = String(addr?.name || '').trim();
  if (!address) return '';
  return name ? `${name} <${address}>` : address;
}

function formatAddresses(...values) {
  for (const value of values) {
    const formatted = normalizeAddressList(value).map(formatOneAddress).filter(Boolean);
    if (formatted.length) return formatted.join(', ');
  }
  return '';
}

function collectEmails(...values) {
  const out = new Set();
  for (const value of values) {
    for (const addr of normalizeAddressList(value)) {
      const email = String(addr?.address || '').trim().toLowerCase();
      if (email) out.add(email);
    }
  }
  return Array.from(out);
}

function headersToObject(headers) {
  if (!headers || typeof headers.entries !== 'function') return {};
  const out = {};
  for (const [key, value] of headers.entries()) out[key] = toJson(value);
  return out;
}

function attachmentSummary(attachments) {
  return (attachments || []).map(att => ({
    filename: att.filename || '',
    contentType: att.contentType || '',
    contentDisposition: att.contentDisposition || '',
    contentId: att.contentId || '',
    checksum: att.checksum || '',
    size: att.size || att.content?.length || 0,
  }));
}

function previewFromParsed(parsed) {
  const text = String(parsed?.text || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 250);
  return htmlToPreview(parsed?.html || '', 250);
}

function getConfig(opts = {}) {
  const accountEmail = String(opts.accountEmail || env.MAIL_SENDER_ACCOUNT || '').trim().toLowerCase();
  const user = String(opts.user || env.MAIL_SENDER_IMAP_USER || accountEmail || '').trim();
  return {
    profileId: opts.profileId || getDefaultProfile().id,
    accountEmail,
    host: opts.host || env.MAIL_SENDER_IMAP_HOST,
    port: asInt(opts.port || env.MAIL_SENDER_IMAP_PORT, 993),
    secure: opts.secure == null ? env.MAIL_SENDER_IMAP_SECURE : !!opts.secure,
    user,
    pass: opts.pass || env.MAIL_SENDER_IMAP_PASS,
    accessToken: opts.accessToken || env.MAIL_SENDER_IMAP_ACCESS_TOKEN,
    mailbox: opts.mailbox || env.MAIL_SENDER_IMAP_MAILBOX || '[Gmail]/Sent Mail',
    limit: opts.limit == null ? asInt(env.MAIL_SENDER_SYNC_LIMIT, 500) : asInt(opts.limit, 500),
    maxBytes: opts.maxBytes == null ? asInt(env.MAIL_SENDER_MAX_BYTES, 5 * 1024 * 1024) : asInt(opts.maxBytes, 5 * 1024 * 1024),
    socketTimeoutMs: opts.socketTimeoutMs == null ? asInt(env.MAIL_SENDER_SOCKET_TIMEOUT_MS, 10 * 60 * 1000) : asInt(opts.socketTimeoutMs, 10 * 60 * 1000),
    sentSince: opts.sentSince || env.MAIL_SENDER_SENT_SINCE || '',
    full: !!opts.full,
  };
}

function missingConfig(cfg) {
  const missing = [];
  if (!cfg.accountEmail) missing.push('MAIL_SENDER_ACCOUNT');
  if (!cfg.host) missing.push('MAIL_SENDER_IMAP_HOST');
  if (!cfg.user) missing.push('MAIL_SENDER_IMAP_USER');
  if (!cfg.pass && !cfg.accessToken) missing.push('MAIL_SENDER_IMAP_PASS or MAIL_SENDER_IMAP_ACCESS_TOKEN');
  return missing;
}

function createClient(cfg) {
  const auth = { user: cfg.user };
  if (cfg.accessToken) auth.accessToken = cfg.accessToken;
  else auth.pass = cfg.pass;

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth,
    logger: false,
    clientInfo: { name: 'JotFlow Mail Sender Sync' },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: cfg.socketTimeoutMs,
    maxLiteralSize: Math.max(cfg.maxBytes, 1024 * 1024),
  });
  client.on('error', err => {
    console.warn('[mail-sender] IMAP client error:', err.message);
  });
  return client;
}

async function openMailbox(client, preferredMailbox) {
  try {
    const mailbox = await client.mailboxOpen(preferredMailbox, { readOnly: true });
    return { mailbox, path: mailbox.path || preferredMailbox };
  } catch (err) {
    const boxes = await client.list();
    const sent = boxes.find(box => box.specialUse === '\\Sent')
      || boxes.find(box => /(^|[/\\])sent( mail)?$/i.test(box.path || box.name || ''));
    if (!sent || sent.path === preferredMailbox) throw err;
    const mailbox = await client.mailboxOpen(sent.path, { readOnly: true });
    return { mailbox, path: mailbox.path || sent.path };
  }
}

async function getLastUid({ profileId, accountEmail, mailbox, uidValidity }) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(message_uid), 0)::text AS uid
       FROM jotform_mail_sender
      WHERE profile_id = $1
        AND account_email = $2
        AND mailbox = $3
        AND uid_validity = $4`,
    [profileId, accountEmail, mailbox, uidValidity],
  );
  return asInt(rows[0]?.uid, 0);
}

function buildSearchQuery(cfg, lastUid) {
  const query = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { all: true };
  if (cfg.sentSince) query.sentSince = cfg.sentSince;
  return query;
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function parseMessageSource(client, message, cfg) {
  const size = Number(message.size || 0);
  if (size > cfg.maxBytes) {
    return {
      parsed: null,
      bodySynced: false,
      syncError: `Body skipped because message is ${size} bytes; MAIL_SENDER_MAX_BYTES is ${cfg.maxBytes}`,
    };
  }

  try {
    const sourceMessage = await client.fetchOne(String(message.uid), { source: true }, { uid: true });
    if (!sourceMessage?.source) return { parsed: null, bodySynced: false, syncError: 'Message source was empty' };
    const parsed = await simpleParser(sourceMessage.source, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
    });
    return { parsed, bodySynced: true, syncError: '' };
  } catch (err) {
    return { parsed: null, bodySynced: false, syncError: String(err.message || err) };
  }
}

function buildRow(cfg, mailbox, uidValidity, message, parsedResult) {
  const parsed = parsedResult.parsed || {};
  const envelope = message.envelope || {};
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : '';
  const bodyText = String(parsed.text || '');
  const sentAt = asDate(parsed.date) || asDate(envelope.date) || asDate(message.internalDate);
  const internalDate = asDate(message.internalDate);
  const toAddr = formatAddresses(parsed.to, envelope.to);
  const ccAddr = formatAddresses(parsed.cc, envelope.cc);
  const bccAddr = formatAddresses(parsed.bcc, envelope.bcc);
  const actionLinks = extractActionLinks(bodyHtml);

  return {
    profileId: cfg.profileId,
    accountEmail: cfg.accountEmail,
    mailbox,
    uidValidity,
    messageUid: message.uid,
    messageId: String(parsed.messageId || envelope.messageId || ''),
    emailId: String(message.emailId || ''),
    threadId: String(message.threadId || ''),
    subject: String(parsed.subject || envelope.subject || ''),
    fromAddr: formatAddresses(parsed.from, envelope.from),
    senderAddr: formatAddresses(envelope.sender),
    replyToAddr: formatAddresses(parsed.replyTo, envelope.replyTo),
    toAddr,
    ccAddr,
    bccAddr,
    recipientEmails: collectEmails(parsed.to, parsed.cc, parsed.bcc, envelope.to, envelope.cc, envelope.bcc),
    sentAt,
    internalDate,
    sizeBytes: Number(message.size || 0),
    flags: Array.from(message.flags || []),
    labels: Array.from(message.labels || []),
    headers: headersToObject(parsed.headers),
    bodyText,
    bodyHtml,
    preview: previewFromParsed(parsed),
    actionLinks,
    attachments: attachmentSummary(parsed.attachments),
    bodySynced: parsedResult.bodySynced,
    syncError: parsedResult.syncError,
  };
}

async function upsertRow(row) {
  await pool.query(
    `INSERT INTO jotform_mail_sender
       (profile_id, account_email, mailbox, uid_validity, message_uid,
        message_id, email_id, thread_id, subject, from_addr, sender_addr,
        reply_to_addr, to_addr, cc_addr, bcc_addr, recipient_emails,
        sent_at, internal_date, size_bytes, flags, labels, headers,
        body_text, body_html, preview, action_links, attachments,
        body_synced, sync_error, synced_at, created_at, updated_at)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,now(),now(),now())
     ON CONFLICT (profile_id, account_email, mailbox, uid_validity, message_uid)
     DO UPDATE SET
       message_id = EXCLUDED.message_id,
       email_id = EXCLUDED.email_id,
       thread_id = EXCLUDED.thread_id,
       subject = EXCLUDED.subject,
       from_addr = EXCLUDED.from_addr,
       sender_addr = EXCLUDED.sender_addr,
       reply_to_addr = EXCLUDED.reply_to_addr,
       to_addr = EXCLUDED.to_addr,
       cc_addr = EXCLUDED.cc_addr,
       bcc_addr = EXCLUDED.bcc_addr,
       recipient_emails = EXCLUDED.recipient_emails,
       sent_at = EXCLUDED.sent_at,
       internal_date = EXCLUDED.internal_date,
       size_bytes = EXCLUDED.size_bytes,
       flags = EXCLUDED.flags,
       labels = EXCLUDED.labels,
       headers = EXCLUDED.headers,
       body_text = EXCLUDED.body_text,
       body_html = EXCLUDED.body_html,
       preview = EXCLUDED.preview,
       action_links = EXCLUDED.action_links,
       attachments = EXCLUDED.attachments,
       body_synced = EXCLUDED.body_synced,
       sync_error = EXCLUDED.sync_error,
       synced_at = now(),
       updated_at = now()`,
    [
      row.profileId,
      row.accountEmail,
      row.mailbox,
      row.uidValidity,
      row.messageUid,
      row.messageId,
      row.emailId,
      row.threadId,
      row.subject,
      row.fromAddr,
      row.senderAddr,
      row.replyToAddr,
      row.toAddr,
      row.ccAddr,
      row.bccAddr,
      JSON.stringify(row.recipientEmails),
      row.sentAt,
      row.internalDate,
      row.sizeBytes,
      JSON.stringify(row.flags),
      JSON.stringify(row.labels),
      JSON.stringify(row.headers),
      row.bodyText,
      row.bodyHtml,
      row.preview,
      JSON.stringify(row.actionLinks),
      JSON.stringify(row.attachments),
      row.bodySynced,
      row.syncError,
    ],
  );
}

async function syncJotformMailSender(opts = {}) {
  if (isRunning && !opts.allowConcurrent) return { skipped: true, reason: 'already_running' };
  const cfg = getConfig(opts);
  const missing = missingConfig(cfg);
  if (missing.length) {
    return {
      skipped: true,
      reason: 'missing_credentials',
      accountEmail: cfg.accountEmail,
      missing,
    };
  }

  isRunning = true;
  const client = createClient(cfg);
  let mailboxPath = cfg.mailbox;
  let uidValidity = '';
  let found = 0;
  let selected = 0;
  let synced = 0;
  let failed = 0;
  let remaining = 0;
  let lastUid = 0;

  try {
    await client.connect();
    const opened = await openMailbox(client, cfg.mailbox);
    mailboxPath = opened.path;
    uidValidity = String(opened.mailbox.uidValidity || '');
    lastUid = cfg.full ? 0 : await getLastUid({
      profileId: cfg.profileId,
      accountEmail: cfg.accountEmail,
      mailbox: mailboxPath,
      uidValidity,
    });

    const searchResult = await client.search(buildSearchQuery(cfg, lastUid), { uid: true });
    let uids = Array.isArray(searchResult) ? searchResult.filter(Boolean).sort((a, b) => a - b) : [];
    found = uids.length;
    if (cfg.limit > 0 && uids.length > cfg.limit) {
      remaining = uids.length - cfg.limit;
      uids = uids.slice(0, cfg.limit);
    }
    selected = uids.length;

    for (const uidBatch of chunk(uids, 25)) {
      const messages = [];
      for await (const message of client.fetch(uidBatch, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        labels: true,
        size: true,
        emailId: true,
        threadId: true,
      }, { uid: true })) {
        messages.push(message);
      }

      for (const message of messages) {
        try {
          const parsedResult = await parseMessageSource(client, message, cfg);
          const row = buildRow(cfg, mailboxPath, uidValidity, message, parsedResult);
          await upsertRow(row);
          synced += 1;
        } catch (err) {
          failed += 1;
          console.warn(`[mail-sender] failed to sync UID ${message.uid}:`, err.message);
        }
      }
    }

    return {
      accountEmail: cfg.accountEmail,
      profileId: cfg.profileId,
      mailbox: mailboxPath,
      uidValidity,
      lastUid,
      found,
      selected,
      synced,
      failed,
      remaining,
    };
  } finally {
    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    }
    isRunning = false;
  }
}

module.exports = {
  getMailSenderConfig: getConfig,
  syncJotformMailSender,
};
