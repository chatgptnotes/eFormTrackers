import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * ONE-TIME SETUP ENDPOINT
 * GET /api/setup-db  → returns the SQL to run in Supabase Dashboard SQL Editor
 * POST /api/setup-db → runs the DDL if SUPABASE_DB_URL env var is set
 *
 * To use the POST path:
 *   1. Add SUPABASE_DB_URL to Vercel env vars:
 *      postgresql://postgres:[DB_PASSWORD]@db.eekudqlzzklhyhwkqvme.supabase.co:5432/postgres
 *   2. Call: curl -X POST https://<your-domain>/api/setup-db
 *   3. Once the table exists, this endpoint is no longer needed.
 */

const SQL = `
-- 1. Create jf_signatures table
CREATE TABLE IF NOT EXISTS public.jf_signatures (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  text         NOT NULL,
  level          smallint     NOT NULL,
  approver_email text,
  approver_name  text,
  comment        text,
  signature_url  text         NOT NULL,
  created_at     timestamptz  DEFAULT now()
);

-- 2. Index on submission_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_jf_signatures_submission_id
  ON public.jf_signatures (submission_id);

-- 3. Enable Row Level Security
ALTER TABLE public.jf_signatures ENABLE ROW LEVEL SECURITY;

-- 4. Allow SELECT for anon and authenticated
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_signatures' AND policyname = 'allow_select_all'
  ) THEN
    CREATE POLICY "allow_select_all"
      ON public.jf_signatures FOR SELECT
      TO anon, authenticated USING (true);
  END IF;
END $$;

-- 5. Allow INSERT for anon and authenticated
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_signatures' AND policyname = 'allow_insert_all'
  ) THEN
    CREATE POLICY "allow_insert_all"
      ON public.jf_signatures FOR INSERT
      TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

-- 6. Allow UPDATE for anon and authenticated
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_signatures' AND policyname = 'allow_update_all'
  ) THEN
    CREATE POLICY "allow_update_all"
      ON public.jf_signatures FOR UPDATE
      TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 7. Add needs_sync column to jf_submissions (for native JotForm approval detection)
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS needs_sync boolean DEFAULT false;

-- 8. Expand jf_submissions with full submission data columns
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS submitter_email TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS submitter_name TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS approver_email TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS amount TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS form_title TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS workflow_tasks JSONB DEFAULT '[]';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS level_history JSONB DEFAULT '[]';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS pending_approver_name TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS pending_approver_email TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS jotform_status TEXT DEFAULT 'Pending';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS edit_link TEXT DEFAULT '';
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS created_at_jf TIMESTAMPTZ;
ALTER TABLE public.jf_submissions ADD COLUMN IF NOT EXISTS updated_at_jf TIMESTAMPTZ;

-- 9. Create jf_approval_history table for per-level approval tracking
CREATE TABLE IF NOT EXISTS public.jf_approval_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   TEXT         NOT NULL,
  form_id         TEXT         NOT NULL,
  level           SMALLINT     NOT NULL,
  action          TEXT         NOT NULL,
  approver_name   TEXT         DEFAULT '',
  approver_email  TEXT         DEFAULT '',
  comment         TEXT         DEFAULT '',
  actioned_at     TIMESTAMPTZ  DEFAULT now(),
  created_at      TIMESTAMPTZ  DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jf_approval_history_sub_level
  ON public.jf_approval_history (submission_id, level);
CREATE INDEX IF NOT EXISTS idx_jf_approval_history_submission
  ON public.jf_approval_history (submission_id);

-- 10. RLS for jf_approval_history
ALTER TABLE public.jf_approval_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approval_history' AND policyname = 'allow_select_all'
  ) THEN
    CREATE POLICY "allow_select_all"
      ON public.jf_approval_history FOR SELECT
      TO anon, authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approval_history' AND policyname = 'allow_insert_all'
  ) THEN
    CREATE POLICY "allow_insert_all"
      ON public.jf_approval_history FOR INSERT
      TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approval_history' AND policyname = 'allow_update_all'
  ) THEN
    CREATE POLICY "allow_update_all"
      ON public.jf_approval_history FOR UPDATE
      TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 11. Approver configuration per form per level
CREATE TABLE IF NOT EXISTS public.jf_approver_config (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         TEXT         NOT NULL,
  level           SMALLINT     NOT NULL,
  approver_name   TEXT         NOT NULL DEFAULT '',
  approver_email  TEXT         NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ  DEFAULT now(),
  updated_at      TIMESTAMPTZ  DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jf_approver_config_form_level
  ON public.jf_approver_config (form_id, level);

ALTER TABLE public.jf_approver_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approver_config' AND policyname = 'allow_select_all'
  ) THEN
    CREATE POLICY "allow_select_all"
      ON public.jf_approver_config FOR SELECT
      TO anon, authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approver_config' AND policyname = 'allow_insert_all'
  ) THEN
    CREATE POLICY "allow_insert_all"
      ON public.jf_approver_config FOR INSERT
      TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approver_config' AND policyname = 'allow_update_all'
  ) THEN
    CREATE POLICY "allow_update_all"
      ON public.jf_approver_config FOR UPDATE
      TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jf_approver_config' AND policyname = 'allow_delete_all'
  ) THEN
    CREATE POLICY "allow_delete_all"
      ON public.jf_approver_config FOR DELETE
      TO anon, authenticated USING (true);
  END IF;
END $$;
`.trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // GET: return the SQL for manual execution
  if (req.method === 'GET') {
    return res.status(200).json({
      instructions: [
        '1. Go to: https://supabase.com/dashboard/project/eekudqlzzklhyhwkqvme/sql/new',
        '2. Paste the SQL below into the editor and click Run',
        '3. Or set SUPABASE_DB_URL in Vercel and POST to this endpoint',
      ],
      sql: SQL,
    });
  }

  // POST: run the DDL via direct Postgres connection (requires SUPABASE_DB_URL env var)
  if (req.method === 'POST') {
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      return res.status(400).json({
        error: 'SUPABASE_DB_URL env var not set',
        hint: 'Add SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.eekudqlzzklhyhwkqvme.supabase.co:5432/postgres to Vercel env vars',
        sql: SQL,
      });
    }

    try {
      // Dynamically import pg to avoid bundling issues
      const { Client } = await import('pg');
      const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      await client.query(SQL);
      await client.end();
      return res.status(200).json({ success: true, message: 'jf_signatures table created successfully' });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
