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
