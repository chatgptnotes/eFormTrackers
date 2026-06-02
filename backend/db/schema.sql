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
