/**
 * add-notification-recipient.js  (Approach B — see plan)
 *
 * Bulk-adds ONE address as an extra notification recipient on every form in the
 * GDMO workspace, so JotForm copies that address on future submissions.
 *
 *   ⚠️  This MUTATES GDMO **production** forms. It is dry-run by default and only
 *       writes with --apply. It only affects FUTURE *notification* emails — not
 *       autoresponders and not past submissions. For a complete record of all
 *       email (including autoresponders + history) use Approach A: the "All
 *       Emails" archive (lib/email-archiver.js).
 *
 *   ⚠️  The `emails`-property write is NOT documented for the enterprise instance.
 *       ALWAYS probe a single form first:  --form=<id> --apply  then verify the
 *       copy actually arrives before any bulk run.
 *
 * Usage (from backend/):
 *   node scripts/add-notification-recipient.js --email=you@dept.gov.ae               # dry-run, all forms
 *   node scripts/add-notification-recipient.js --email=you@dept.gov.ae --form=2510   # dry-run, one form
 *   node scripts/add-notification-recipient.js --email=you@dept.gov.ae --form=2510 --apply   # PROBE write
 *   node scripts/add-notification-recipient.js --email=you@dept.gov.ae --apply       # bulk write (after probe)
 *   node scripts/add-notification-recipient.js --email=you@dept.gov.ae --limit=5     # cap forms (testing)
 *
 * Env: needs DATABASE_URL-style JotForm config from .env (JOTFORM_API_KEY_GDMO etc.)
 */
require('dotenv').config();
const { jotformFetch, buildJotformUrl, resolveApiKey } = require('../lib/jotform');
const { pMapLimit } = require('../lib/concurrency');
const { getDefaultProfile } = require('../lib/profiles');

function argVal(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
// Which API profile to operate on (default = the registry's default profile).
const KEY_TYPE = argVal('profile') || getDefaultProfile().id;
const APPLY = process.argv.includes('--apply');
const EMAIL = (argVal('email') || process.env.FORWARD_EMAIL || '').trim().toLowerCase();
const ONE_FORM = argVal('form');
const LIMIT = parseInt(argVal('limit') || '0', 10);

if (!EMAIL || !EMAIL.includes('@')) {
  console.error('ERROR: provide a target address via --email=you@domain or FORWARD_EMAIL env.');
  process.exit(1);
}

// Read the existing emails[] array off a form's properties (tolerant of shapes).
async function getFormEmails(formId) {
  const data = await jotformFetch(`form/${formId}/properties`, { keyType: KEY_TYPE });
  const props = data.content || data || {};
  let emails = props.emails;
  if (typeof emails === 'string') {
    try { emails = JSON.parse(emails); } catch { emails = []; }
  }
  return Array.isArray(emails) ? emails : [];
}

function alreadyHas(emails, addr) {
  return emails.some(e => String(e?.to || '').toLowerCase().includes(addr));
}

// POST the full emails array back as form-encoded properties (existing + new).
// This is the write whose support must be confirmed by the probe.
async function writeFormEmails(formId, emails) {
  const params = new URLSearchParams();
  emails.forEach((e, i) => {
    for (const [k, v] of Object.entries(e)) {
      if (v != null) params.append(`emails[${i}][${k}]`, String(v));
    }
  });
  const url = buildJotformUrl(`form/${formId}/properties`, KEY_TYPE);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'APIKEY': resolveApiKey(KEY_TYPE) },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`write failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function listForms() {
  if (ONE_FORM) return [{ id: ONE_FORM, title: '(single form)' }];
  const all = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const data = await jotformFetch('user/forms', { params: { limit: 1000, offset }, keyType: KEY_TYPE });
    const page = (data.content || []).filter(f => f.id);
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

(async () => {
  console.log(`Target recipient : ${EMAIL}`);
  console.log(`Mode             : ${APPLY ? 'APPLY (writes to JotForm)' : 'DRY-RUN (no writes)'}`);
  console.log(`Scope            : ${ONE_FORM ? `form ${ONE_FORM}` : 'all forms'}${LIMIT ? `, capped at ${LIMIT}` : ''}\n`);

  let forms = await listForms();
  if (LIMIT) forms = forms.slice(0, LIMIT);
  console.log(`Found ${forms.length} form(s).\n`);

  let toChange = 0, changed = 0, skipped = 0, failed = 0;

  await pMapLimit(forms, 3, async (form) => {
    const formId = String(form.id);
    try {
      const emails = await getFormEmails(formId);
      if (alreadyHas(emails, EMAIL)) {
        skipped++;
        return;
      }
      toChange++;
      const template = emails.find(e => String(e?.type || '').includes('notification')) || {};
      const newEntry = {
        type: 'notification',
        name: `notification_copy_${Date.now()}`,
        from: template.from || 'default',
        to: EMAIL,
        subject: template.subject || 'New Submission on {form_title}',
        html: template.html != null ? template.html : 'true',
      };
      const next = [...emails, newEntry];

      if (!APPLY) {
        console.log(`WOULD ADD → form ${formId} "${form.title || ''}" (had ${emails.length} email rule(s))`);
        return;
      }
      await writeFormEmails(formId, next);
      // Verify the write stuck.
      const after = await getFormEmails(formId);
      if (alreadyHas(after, EMAIL)) { changed++; console.log(`ADDED   → form ${formId} "${form.title || ''}"`); }
      else { failed++; console.warn(`UNVERIFIED → form ${formId}: write returned OK but address not present on re-read`); }
    } catch (err) {
      failed++;
      console.warn(`FAILED  → form ${formId}: ${err.message}`);
    }
  });

  console.log(`\nSummary: ${APPLY ? `${changed} changed` : `${toChange} would change`}, ${skipped} already had it, ${failed} failed.`);
  if (!APPLY && toChange > 0) console.log('Re-run with --apply (probe one form first via --form=<id> --apply).');
  process.exit(failed > 0 && APPLY ? 1 : 0);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
