-- JotFlow — Full PostgreSQL 18 Schema
-- Replaces Supabase-hosted schema with standalone PostgreSQL

-- ============================================================
-- 1. session (express-session + connect-pg-simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR(255) PRIMARY KEY NOT NULL,
  sess   JSON        NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

-- ============================================================
-- 2. users (replaces Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. organizations
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT '',
  slug        TEXT UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'starter',
  logo_url    TEXT DEFAULT '',
  branding    JSONB DEFAULT '{}',
  owner_id    UUID,
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
-- Add columns for existing deployments that created the table without them
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS branding JSONB DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Seed default org
INSERT INTO organizations (id, name, slug)
VALUES ('971589dd-afcb-4a12-8900-47626e4d59cc', 'Default Org', 'default')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. profiles (replaces Supabase profiles table)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  department  TEXT DEFAULT '',
  role        TEXT DEFAULT 'viewer',
  org_id      UUID REFERENCES organizations(id),
  avatar_url  TEXT DEFAULT '',
  preferences JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. org_members
-- ============================================================
CREATE TABLE IF NOT EXISTS org_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- ============================================================
-- 6. jf_submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS jf_submissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jotform_submission_id  TEXT UNIQUE NOT NULL,
  form_id                TEXT NOT NULL,
  form_title             TEXT DEFAULT '',
  title                  TEXT DEFAULT '',
  description            TEXT DEFAULT '',
  submitted_by           TEXT DEFAULT '',
  submitter_name         TEXT DEFAULT '',
  submitter_email        TEXT DEFAULT '',
  department             TEXT DEFAULT '',
  submission_date        TIMESTAMPTZ,
  current_level          SMALLINT DEFAULT 1,
  status                 TEXT DEFAULT 'pending',
  priority               TEXT DEFAULT 'medium',
  amount                 TEXT DEFAULT '',
  approver_name          TEXT DEFAULT '',
  approver_email         TEXT DEFAULT '',
  pending_approver_name  TEXT DEFAULT '',
  pending_approver_email TEXT DEFAULT '',
  jotform_status         TEXT DEFAULT 'Pending',
  answers                JSONB DEFAULT '{}',
  workflow_tasks         JSONB DEFAULT '[]',
  level_history          JSONB DEFAULT '[]',
  raw_data               JSONB DEFAULT '{}',
  edit_link              TEXT DEFAULT '',
  approval_url           TEXT,
  needs_sync             BOOLEAN DEFAULT false,
  created_at_jf          TIMESTAMPTZ,
  updated_at_jf          TIMESTAMPTZ,
  days_at_level          INT DEFAULT 0,
  total_days             INT DEFAULT 0,
  last_synced            TIMESTAMPTZ DEFAULT now(),
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jf_submissions_form ON jf_submissions (form_id);
CREATE INDEX IF NOT EXISTS idx_jf_submissions_status ON jf_submissions (status);
-- The dashboard read filters by form_id (often `form_id = ANY(...)`) and ALWAYS
-- orders by submission_date DESC. These composites let Postgres satisfy the
-- filter + sort from the index instead of sorting the matched rows in memory.
CREATE INDEX IF NOT EXISTS idx_jf_submissions_form_date
  ON jf_submissions (form_id, submission_date DESC);
CREATE INDEX IF NOT EXISTS idx_jf_submissions_status_date
  ON jf_submissions (status, submission_date DESC);

-- ============================================================
-- 7. jf_approval_history
-- ============================================================
CREATE TABLE IF NOT EXISTS jf_approval_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   TEXT NOT NULL,
  form_id         TEXT NOT NULL,
  level           SMALLINT NOT NULL,
  action          TEXT NOT NULL,
  approver_name   TEXT DEFAULT '',
  approver_email  TEXT DEFAULT '',
  comment         TEXT DEFAULT '',
  actioned_at     TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jf_approval_history_sub_level
  ON jf_approval_history (submission_id, level);
CREATE INDEX IF NOT EXISTS idx_jf_approval_history_submission
  ON jf_approval_history (submission_id);

-- ============================================================
-- 8. jf_approver_config
-- ============================================================
CREATE TABLE IF NOT EXISTS jf_approver_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         TEXT NOT NULL,
  level           SMALLINT NOT NULL,
  approver_name   TEXT NOT NULL DEFAULT '',
  approver_email  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jf_approver_config_form_level
  ON jf_approver_config (form_id, level);

-- ============================================================
-- 9. jf_signatures
-- ============================================================
CREATE TABLE IF NOT EXISTS jf_signatures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  TEXT NOT NULL,
  level          SMALLINT NOT NULL,
  approver_email TEXT,
  approver_name  TEXT,
  comment        TEXT,
  signature_url  TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jf_signatures_submission_id
  ON jf_signatures (submission_id);

-- ============================================================
-- 10. notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  user_email      TEXT NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  submission_id   TEXT,
  form_id         TEXT,
  read            BOOLEAN DEFAULT false,
  data            JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_email ON notifications (user_email);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
-- GET /api/notifications: WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2
CREATE INDEX IF NOT EXISTS idx_notifications_email_created
  ON notifications (user_email, created_at DESC);

-- ============================================================
-- 11. activity_log
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log (user_email);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log (entity_type, entity_id);

-- ============================================================
-- 12. password_resets
-- ============================================================
CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);

-- ============================================================
-- 13. support_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS support_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 14. jf_forms (form metadata + creator, synced by poller)
-- ============================================================
CREATE TABLE IF NOT EXISTS jf_forms (
  form_id          TEXT PRIMARY KEY,
  title            TEXT DEFAULT '',
  creator_username TEXT DEFAULT '',
  status           TEXT DEFAULT '',
  created_at_jf    TIMESTAMPTZ,
  updated_at_jf    TIMESTAMPTZ,
  last_synced      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 15. email_logs (workflow task assignment tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     TEXT NOT NULL,
  form_id           TEXT NOT NULL,
  form_title        TEXT DEFAULT '',
  task_id           TEXT NOT NULL,
  task_name         TEXT DEFAULT '',
  task_type         TEXT DEFAULT '',
  assignee_name     TEXT DEFAULT '',
  assignee_email    TEXT DEFAULT '',
  task_status       TEXT DEFAULT '',
  assigned_at       TIMESTAMPTZ,
  submitted_by_name  TEXT DEFAULT '',
  submitted_by_email TEXT DEFAULT '',
  access_link        TEXT DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(submission_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_email_logs_submission ON email_logs (submission_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_assignee  ON email_logs (assignee_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_form      ON email_logs (form_id);

-- ============================================================
-- 15b. jf_email_archive (every email JotForm sent, body included)
-- ============================================================
-- Unlike email_logs (one row per workflow TASK assignment), this is one row
-- per actual email JotForm sent — harvested from enterprise/system-logs +
-- emailq/{id} bodies before JotForm's ~6-day log retention drops them, so the
-- "All Emails" admin view has a permanent, complete record.
CREATE TABLE IF NOT EXISTS jf_email_archive (
  profile_id    TEXT NOT NULL DEFAULT 'gdmo',  -- which JotForm API this came from
  email_id      TEXT NOT NULL,           -- JotForm emailId
  submission_id TEXT DEFAULT '',
  form_id       TEXT DEFAULT '',
  form_title    TEXT DEFAULT '',
  email_type    TEXT DEFAULT '',         -- notification | autoresponder | unknown
  recipient_email TEXT DEFAULT '',
  recipient_emails JSONB DEFAULT '[]',
  recipient_user_jf_id TEXT DEFAULT '',
  recipient_user_name TEXT DEFAULT '',
  to_addr       TEXT DEFAULT '',
  from_addr     TEXT DEFAULT '',
  subject       TEXT DEFAULT '',
  body_html     TEXT DEFAULT '',
  preview       TEXT DEFAULT '',
  action_links  JSONB DEFAULT '[]',
  sent_at       TIMESTAMPTZ,
  forwarded_at  TIMESTAMPTZ,
  forwarded_to  TEXT DEFAULT '',
  forward_error TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, email_id)
);
CREATE INDEX IF NOT EXISTS idx_email_archive_sub  ON jf_email_archive (submission_id);
CREATE INDEX IF NOT EXISTS idx_email_archive_to   ON jf_email_archive (to_addr);
CREATE INDEX IF NOT EXISTS idx_email_archive_sent ON jf_email_archive (profile_id, sent_at DESC);

-- ============================================================
-- 15c. allowlist_user (recipients seen in JotForm-sent emails)
-- ============================================================
CREATE TABLE IF NOT EXISTS allowlist_user (
  profile_id     TEXT NOT NULL DEFAULT 'gdmo',
  username       TEXT DEFAULT '',
  mailid         TEXT NOT NULL,
  name           TEXT DEFAULT '',
  jf_id          TEXT DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'jotform_email',
  first_seen_at  TIMESTAMPTZ DEFAULT now(),
  last_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_email_id  TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, mailid)
);
CREATE INDEX IF NOT EXISTS idx_allowlist_user_mailid
  ON allowlist_user (lower(mailid));
CREATE INDEX IF NOT EXISTS idx_allowlist_user_username
  ON allowlist_user (profile_id, lower(username));

-- ============================================================
-- 15d. jf_email_forward_log (backend copy / forward target audit)
-- ============================================================
-- One row per archived email per target mailbox. This keeps the backend-side
-- mail copy separate from the raw JotForm archive so the two methods can be
-- audited independently.
CREATE TABLE IF NOT EXISTS jf_email_forward_log (
  profile_id       TEXT NOT NULL DEFAULT 'gdmo',
  email_id         TEXT NOT NULL,
  target_mailbox   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',   -- queued | sent | failed | skipped
  method           TEXT NOT NULL DEFAULT 'smtp_forward',
  submission_id    TEXT DEFAULT '',
  form_id          TEXT DEFAULT '',
  form_title       TEXT DEFAULT '',
  email_type       TEXT DEFAULT '',
  recipient_email  TEXT DEFAULT '',
  recipient_emails JSONB DEFAULT '[]',
  recipient_user_jf_id TEXT DEFAULT '',
  recipient_user_name TEXT DEFAULT '',
  subject          TEXT DEFAULT '',
  body_html        TEXT DEFAULT '',
  preview          TEXT DEFAULT '',
  action_links     JSONB DEFAULT '[]',
  sent_at          TIMESTAMPTZ,
  attempted_at     TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  delivery_error   TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, email_id, target_mailbox)
);
CREATE INDEX IF NOT EXISTS idx_email_forward_target ON jf_email_forward_log (target_mailbox, status);
CREATE INDEX IF NOT EXISTS idx_email_forward_sent   ON jf_email_forward_log (profile_id, delivered_at DESC);

-- ============================================================
-- 15e. jotform_mail_sender (synced Sent mailbox copy)
-- ============================================================
-- Mirrors the configured sender mailbox's Sent folder into PostgreSQL. This is
-- separate from jf_email_archive because it is sourced from the mailbox itself
-- (for example Gmail IMAP) instead of JotForm's enterprise email event log.
CREATE TABLE IF NOT EXISTS jotform_mail_sender (
  profile_id       TEXT NOT NULL DEFAULT 'gdmo',
  account_email    TEXT NOT NULL,
  mailbox          TEXT NOT NULL DEFAULT '[Gmail]/Sent Mail',
  uid_validity     TEXT NOT NULL DEFAULT '',
  message_uid      BIGINT NOT NULL,
  message_id       TEXT DEFAULT '',
  email_id         TEXT DEFAULT '',
  thread_id        TEXT DEFAULT '',
  subject          TEXT DEFAULT '',
  from_addr        TEXT DEFAULT '',
  sender_addr      TEXT DEFAULT '',
  reply_to_addr    TEXT DEFAULT '',
  to_addr          TEXT DEFAULT '',
  cc_addr          TEXT DEFAULT '',
  bcc_addr         TEXT DEFAULT '',
  recipient_emails JSONB DEFAULT '[]',
  sent_at          TIMESTAMPTZ,
  internal_date    TIMESTAMPTZ,
  size_bytes       INTEGER DEFAULT 0,
  flags            JSONB DEFAULT '[]',
  labels           JSONB DEFAULT '[]',
  headers          JSONB DEFAULT '{}',
  body_text        TEXT DEFAULT '',
  body_html        TEXT DEFAULT '',
  preview          TEXT DEFAULT '',
  action_links     JSONB DEFAULT '[]',
  attachments      JSONB DEFAULT '[]',
  body_synced      BOOLEAN DEFAULT true,
  sync_error       TEXT DEFAULT '',
  synced_at        TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, account_email, mailbox, uid_validity, message_uid)
);

-- ============================================================
-- 15f. jf_users (JotForm directory — every user the active API can see)
-- ============================================================
-- The JotForm user directory per profile (regular account or enterprise org).
-- `raw` holds the full API payload so "all details" survive even for fields we
-- don't model. Distinct from the local `users` table (app-login accounts).
CREATE TABLE IF NOT EXISTS jf_users (
  profile_id    TEXT NOT NULL DEFAULT 'gdmo',
  jf_id         TEXT NOT NULL,            -- JotForm user id/username
  username      TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  name          TEXT DEFAULT '',
  account_type  TEXT DEFAULT '',          -- ADMIN | USER | DATA_ONLY_USER (the role)
  status        TEXT DEFAULT '',
  avatar_url    TEXT DEFAULT '',
  last_login    TIMESTAMPTZ,
  created_at_jf TIMESTAMPTZ,
  raw           JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, jf_id)
);
CREATE INDEX IF NOT EXISTS idx_jf_users_email ON jf_users (lower(email));
CREATE INDEX IF NOT EXISTS idx_jf_users_type  ON jf_users (profile_id, account_type);

-- ============================================================
-- 16. system_logs (JotForm enterprise activity log mirror)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_logs (
  id            TEXT PRIMARY KEY,
  event_type    TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  form_id       TEXT DEFAULT '',
  submission_id TEXT DEFAULT '',
  ip_address    TEXT DEFAULT '',
  actor_email   TEXT DEFAULT '',
  raw           JSONB,
  logged_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_logs_form       ON system_logs (form_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_submission ON system_logs (submission_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_logged_at  ON system_logs (logged_at DESC);

-- ============================================================
-- 16b. jotform_account_history (JotForm /user/history activity log mirror)
-- ============================================================
-- Mirrors the account History page activity list (e.g. "Email SENT to ...",
-- login events, sender-email changes). This is intentionally separate from
-- enterprise_history and system_logs because /user/history is account-scoped.
CREATE TABLE IF NOT EXISTS jotform_account_history (
  profile_id     TEXT NOT NULL DEFAULT 'gdmo',
  id             TEXT NOT NULL,
  action         TEXT DEFAULT '',
  event_type     TEXT DEFAULT '',
  description    TEXT DEFAULT '',
  actor_email    TEXT DEFAULT '',
  actor_name     TEXT DEFAULT '',
  target_email   TEXT DEFAULT '',
  form_id        TEXT DEFAULT '',
  submission_id  TEXT DEFAULT '',
  ip_address     TEXT DEFAULT '',
  raw            JSONB,
  logged_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, id)
);
CREATE INDEX IF NOT EXISTS idx_account_history_action    ON jotform_account_history (profile_id, action);
CREATE INDEX IF NOT EXISTS idx_account_history_target    ON jotform_account_history (profile_id, lower(target_email));
CREATE INDEX IF NOT EXISTS idx_account_history_logged_at ON jotform_account_history (profile_id, logged_at DESC);

-- ============================================================
-- 17. task_tokens (magic-link task completion, no login needed)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_tokens (
  token         TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  assignee_email TEXT NOT NULL,
  used_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_tokens_submission ON task_tokens (submission_id);
CREATE INDEX IF NOT EXISTS idx_task_tokens_task       ON task_tokens (task_id);

-- ============================================================
-- 18. enterprise_history (JotForm enterprise/history audit trail mirror)
-- ============================================================
CREATE TABLE IF NOT EXISTS enterprise_history (
  id             TEXT PRIMARY KEY,
  action         TEXT DEFAULT '',
  actor_username TEXT DEFAULT '',
  actor_email    TEXT DEFAULT '',
  actor_name     TEXT DEFAULT '',
  ip_address     TEXT DEFAULT '',
  entity_type    TEXT DEFAULT '',
  entity_id      TEXT DEFAULT '',
  raw            JSONB,
  logged_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enterprise_history_action    ON enterprise_history (action);
CREATE INDEX IF NOT EXISTS idx_enterprise_history_logged_at ON enterprise_history (logged_at DESC);

-- ============================================================
-- 19. Multi-profile tagging (added 2026-06) — tag JotForm-sourced data with the
--     profile (API key) it came from so multiple APIs' data coexist. Existing
--     rows backfill to 'gdmo' (the only key used before this change). New writes
--     pass an explicit profile_id; reads filter by the active profile.
-- ============================================================
ALTER TABLE jf_submissions    ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jf_forms          ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE email_logs        ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE system_logs       ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE enterprise_history ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jotform_account_history ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jotform_account_history ADD COLUMN IF NOT EXISTS target_email TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS recipient_email TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS recipient_emails JSONB DEFAULT '[]';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS recipient_user_jf_id TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS recipient_user_name TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ;
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS forwarded_to TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS forward_error TEXT DEFAULT '';
ALTER TABLE jf_email_archive  ADD COLUMN IF NOT EXISTS action_links JSONB DEFAULT '[]';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS email_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS target_mailbox TEXT NOT NULL DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'smtp_forward';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS submission_id TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS form_id TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS form_title TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS email_type TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS recipient_email TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS recipient_emails JSONB DEFAULT '[]';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS recipient_user_jf_id TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS recipient_user_name TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS body_html TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS preview TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS action_links JSONB DEFAULT '[]';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ;
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS delivery_error TEXT DEFAULT '';
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE jf_email_forward_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'gdmo';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS account_email TEXT NOT NULL DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS mailbox TEXT NOT NULL DEFAULT '[Gmail]/Sent Mail';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS uid_validity TEXT NOT NULL DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS message_uid BIGINT NOT NULL DEFAULT 0;
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS message_id TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS email_id TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS thread_id TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS from_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS sender_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS reply_to_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS to_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS cc_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS bcc_addr TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS recipient_emails JSONB DEFAULT '[]';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS internal_date TIMESTAMPTZ;
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS size_bytes INTEGER DEFAULT 0;
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '[]';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS headers JSONB DEFAULT '{}';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS body_text TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS body_html TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS preview TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS action_links JSONB DEFAULT '[]';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS body_synced BOOLEAN DEFAULT true;
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS sync_error TEXT DEFAULT '';
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE jotform_mail_sender ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_jotform_mail_sender_sent
  ON jotform_mail_sender (profile_id, account_email, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_jotform_mail_sender_message_id
  ON jotform_mail_sender (profile_id, account_email, message_id)
  WHERE message_id <> '';
CREATE INDEX IF NOT EXISTS idx_jotform_mail_sender_to
  ON jotform_mail_sender (lower(to_addr));
CREATE INDEX IF NOT EXISTS idx_jotform_mail_sender_subject
  ON jotform_mail_sender (subject);
CREATE INDEX IF NOT EXISTS idx_email_archive_recipient ON jf_email_archive (lower(recipient_email));
CREATE INDEX IF NOT EXISTS idx_email_forward_recipient ON jf_email_forward_log (lower(recipient_email));
CREATE INDEX IF NOT EXISTS idx_jf_submissions_profile ON jf_submissions (profile_id);
CREATE INDEX IF NOT EXISTS idx_jf_forms_profile       ON jf_forms (profile_id);

-- Seed allowlist_user from already archived JotForm emails.
WITH archive_recipient_rows AS (
  SELECT
    a.profile_id,
    lower(btrim(r.mailid)) AS mailid,
    COALESCE(NULLIF(u.username, ''), NULLIF(a.recipient_user_name, ''), NULLIF(u.name, ''), '') AS username,
    COALESCE(NULLIF(a.recipient_user_name, ''), NULLIF(u.name, ''), NULLIF(u.username, ''), '') AS name,
    COALESCE(NULLIF(a.recipient_user_jf_id, ''), NULLIF(u.jf_id, ''), '') AS jf_id,
    a.email_id,
    COALESCE(a.sent_at, a.created_at, now()) AS seen_at
  FROM jf_email_archive a
  CROSS JOIN LATERAL (
    SELECT jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(COALESCE(a.recipient_emails, '[]'::jsonb)) = 'array'
          THEN COALESCE(a.recipient_emails, '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS mailid
    UNION
    SELECT NULLIF(a.recipient_email, '') AS mailid
  ) r
  LEFT JOIN jf_users u
    ON u.profile_id = a.profile_id
   AND lower(u.email) = lower(btrim(r.mailid))
  WHERE COALESCE(btrim(r.mailid), '') <> ''
),
archive_rollup AS (
  SELECT
    profile_id,
    mailid,
    min(seen_at) AS first_seen_at,
    max(seen_at) AS last_seen_at
  FROM archive_recipient_rows
  GROUP BY profile_id, mailid
),
archive_latest AS (
  SELECT DISTINCT ON (profile_id, mailid)
    profile_id,
    mailid,
    username,
    name,
    jf_id,
    email_id
  FROM archive_recipient_rows
  ORDER BY profile_id, mailid, seen_at DESC
)
INSERT INTO allowlist_user
  (profile_id, username, mailid, name, jf_id, source, first_seen_at, last_seen_at, last_email_id, created_at, updated_at)
SELECT
  l.profile_id,
  l.username,
  l.mailid,
  l.name,
  l.jf_id,
  'jotform_email',
  r.first_seen_at,
  r.last_seen_at,
  l.email_id,
  now(),
  now()
FROM archive_latest l
JOIN archive_rollup r
  ON r.profile_id = l.profile_id
 AND r.mailid = l.mailid
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
  updated_at = now();
