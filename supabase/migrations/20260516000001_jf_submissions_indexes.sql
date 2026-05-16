-- Indexes for jf_submissions to accelerate the dashboard read path and
-- the webhook upsert path. All filters/sorts the dashboard performs
-- should hit one of these.
--
-- Run with:  supabase db push   (or paste into the SQL editor)

create index if not exists idx_jf_submissions_submission_date_desc
  on public.jf_submissions (submission_date desc);

create index if not exists idx_jf_submissions_form_id
  on public.jf_submissions (form_id);

create index if not exists idx_jf_submissions_status
  on public.jf_submissions (status);

create index if not exists idx_jf_submissions_current_level
  on public.jf_submissions (current_level);

create index if not exists idx_jf_submissions_pending_approver_email
  on public.jf_submissions (pending_approver_email)
  where pending_approver_email is not null and pending_approver_email <> '';

create index if not exists idx_jf_submissions_submitter_email
  on public.jf_submissions (submitter_email);

create index if not exists idx_jf_submissions_form_status_date
  on public.jf_submissions (form_id, status, submission_date desc);
