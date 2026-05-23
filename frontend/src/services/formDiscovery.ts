/**
 * formDiscovery.ts
 *
 * Dynamically discovers JotForm forms and detects their field structure
 * using label heuristics, so any new form created in JotForm automatically
 * appears in JotFlow without code changes.
 */
import { apiFetch } from '../lib/api';
import { getJotformKeyType } from '../lib/jotformKey';

export interface JFQuestion {
  qid: string;
  text: string;
  name: string;
  type: string;
}

export interface LevelFieldGroup {
  level: number;
  statusFieldId: string;
  approverFieldId: string | null;
  dateFieldId: string | null;
}

export interface DetectedFields {
  nameFieldId:          string | null;
  emailFieldId:         string | null;
  deptFieldId:          string | null;
  priorityFieldId:      string | null;
  descFieldId:          string | null;
  amountFieldId:        string | null;
  overallStatusFieldId: string | null;
  evaluatorEmailFieldId: string | null;            // single-level: next approver email
  evaluatorEmailsByLevel: Record<number, string>;  // multi-level: level → evaluator email field id
  levelFields:          LevelFieldGroup[];
}

export interface JFFormMeta {
  id: string;
  title: string;
  status: string;
  count: number;
  updatedAt: string;
}

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
const FORMS_TTL   = 5  * 60 * 1000; // 5 min
const QUESTIONS_TTL = 60 * 60 * 1000; // 1 hr (questions rarely change)

// ─── User forms list ──────────────────────────────────────────────────────────
export async function fetchUserForms(): Promise<JFFormMeta[]> {
  // Cache key includes the JotForm key type — same /user/forms endpoint
  // resolves to different forms under default vs gdmo, so they must not
  // collide. Without this, the Production toggle returns Testing's cached
  // form list (and the sidebar shows Testing forms while you're on Production).
  const key = `jotflow_forms_v4_${getJotformKeyType()}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const { forms, ts } = JSON.parse(cached);
      if (Date.now() - ts < FORMS_TTL) return forms;
    }
  } catch {}

  try {
    const data = await apiFetch<{ content?: Array<{ id: string; title: string; status: string; count: string; updated_at: string }> }>('/api/jotform?path=user/forms&limit=200&orderby=updated_at&direction=DESC');
    const forms: JFFormMeta[] = (data.content || [])
      .filter((f: { status: string }) => f.status === 'ENABLED')
      .map((f: { id: string; title: string; status: string; count: string; updated_at: string }) => ({
        id: f.id,
        title: f.title || `Form ${f.id}`,
        status: f.status,
        count: parseInt(f.count) || 0,
        updatedAt: f.updated_at || '',
      }));
    localStorage.setItem(key, JSON.stringify({ forms, ts: Date.now() }));
    return forms;
  } catch {
    return [];
  }
}

// ─── Form questions ───────────────────────────────────────────────────────────
export async function fetchFormQuestions(formId: string): Promise<Record<string, JFQuestion>> {
  // Per-keyType cache: a form ID can exist under both keys with different field sets.
  const key = `jotflow_q4_${getJotformKeyType()}_${formId}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const { questions, ts } = JSON.parse(cached);
      if (Date.now() - ts < QUESTIONS_TTL) return questions;
    }
  } catch {}

  try {
    const data = await apiFetch<{ content?: Record<string, unknown> }>(`/api/jotform?path=form/${formId}/questions`);
    // Inject qid from the dict key — JotForm API doesn't include it inside the object
    const raw = data.content || {};
    const questions: Record<string, JFQuestion> = {};
    for (const [qid, q] of Object.entries(raw)) {
      questions[qid] = { ...(q as JFQuestion), qid };
    }
    localStorage.setItem(key, JSON.stringify({ questions, ts: Date.now() }));
    return questions;
  } catch {
    return {};
  }
}

// ─── Field detection via label heuristics ────────────────────────────────────
export function detectFields(questions: Record<string, JFQuestion>): DetectedFields {
  const list = Object.values(questions).sort((a, b) => parseInt(a.qid) - parseInt(b.qid));

  let nameFieldId:          string | null = null;
  let emailFieldId:         string | null = null;
  let deptFieldId:          string | null = null;
  let priorityFieldId:       string | null = null;
  let descFieldId:           string | null = null;
  let amountFieldId:         string | null = null;
  let overallStatusFieldId:  string | null = null;
  let evaluatorEmailFieldId: string | null = null;
  const evaluatorEmailsByLevel: Record<number, string> = {}; // level → field id

  // level → { status, approver, date }
  const byLevel: Record<number, { s?: string; a?: string; d?: string }> = {};

  for (const q of list) {
    const raw = (q.text || q.name || '').trim();
    const lbl = raw.toLowerCase();
    const id  = q.qid;

    // ── submitter name ──
    if (!nameFieldId && (
      q.type === 'control_fullname' ||
      lbl === 'name' || lbl.includes('full name') ||
      lbl.includes('requester') || lbl.includes('submitted by') ||
      lbl.includes('applicant') || lbl.includes('employee name')
    )) { nameFieldId = id; continue; }

    // ── per-level evaluator email (e.g. "L1 Evaluator Email", "L2 Evaluator Email") ──
    const levelEmailMatch = lbl.match(/^(?:l|level)\s*(\d+)\s+(?:evaluator|approver|reviewer)\s+email$/);
    if (levelEmailMatch) {
      evaluatorEmailsByLevel[parseInt(levelEmailMatch[1])] = id;
      continue;
    }

    // ── single evaluator / approver email (next step assignee) — check BEFORE generic email ──
    if (!evaluatorEmailFieldId && (
      lbl.includes('evaluator') || lbl === 'approver email' ||
      lbl.includes('reviewer email') || lbl.includes('assigned to') ||
      lbl.includes('send to') || (lbl.includes('email') && (lbl.includes('evaluat') || lbl.includes('approv')))
    )) { evaluatorEmailFieldId = id; continue; }

    // ── submitter email (exclude evaluator/approver email fields) ──
    if (!emailFieldId && (q.type === 'control_email' || lbl.includes('email') || lbl.includes('e-mail')))
    { emailFieldId = id; continue; }

    // ── department ──
    if (!deptFieldId && (
      lbl.includes('department') || lbl.includes('dept') ||
      lbl.includes('division') || lbl.includes('section') || lbl.includes('unit')
    )) { deptFieldId = id; continue; }

    // ── priority ──
    if (!priorityFieldId && lbl.includes('priority'))
    { priorityFieldId = id; continue; }

    // ── description / title of request ──
    if (!descFieldId && (
      lbl.includes('description') || lbl.includes('subject') ||
      lbl.includes('purpose') || lbl.includes('request detail') ||
      lbl.includes('justification') || lbl.includes('title') ||
      (lbl.includes('detail') && !lbl.includes('date'))
    )) { descFieldId = id; continue; }

    // ── amount / budget ──
    if (!amountFieldId && (
      q.type === 'control_number' ||
      lbl.includes('amount') || lbl.includes('budget') ||
      lbl.includes(' cost') || lbl.includes('value') || lbl.includes('price')
    )) { amountFieldId = id; continue; }

    // ── overall / final status (no level number) ──
    const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
    if (!overallStatusFieldId && !hasLevel && (
      lbl === 'status' || lbl === 'overall status' ||
      lbl === 'final status' || lbl === 'approval status' ||
      (lbl.includes('overall') && lbl.includes('status'))
    )) { overallStatusFieldId = id; continue; }

    // ── level-specific fields ──
    const lvlMatch = lbl.match(/(?:^|\b)(?:l|level|stage)\s*(\d+)(?:\b|$)/);
    if (lvlMatch) {
      const lvl = parseInt(lvlMatch[1]);
      if (!byLevel[lvl]) byLevel[lvl] = {};
      if (lbl.includes('status') || lbl.includes('decision') || lbl.includes('approval')) {
        if (!byLevel[lvl].s) byLevel[lvl].s = id;
      } else if (lbl.includes('approver') || lbl.includes('approved by') || lbl.includes('reviewer')) {
        if (!byLevel[lvl].a) byLevel[lvl].a = id;
      } else if (lbl.includes('date') || lbl.includes('time')) {
        if (!byLevel[lvl].d) byLevel[lvl].d = id;
      } else {
        // Generic level field → treat as status if no status yet
        if (!byLevel[lvl].s) byLevel[lvl].s = id;
      }
    }

    // ── single-level approval status (has "approval" + "status" but no level number) ──
    if (!overallStatusFieldId && !hasLevel && lbl.includes('approval') && lbl.includes('status'))
    { overallStatusFieldId = id; }
  }

  const levelFields: LevelFieldGroup[] = Object.entries(byLevel)
    .filter(([, f]) => !!f.s)
    .map(([lvl, f]) => ({
      level: parseInt(lvl),
      statusFieldId:   f.s!,
      approverFieldId: f.a || null,
      dateFieldId:     f.d || null,
    }))
    .sort((a, b) => a.level - b.level);

  return {
    nameFieldId, emailFieldId, deptFieldId, priorityFieldId,
    descFieldId, amountFieldId, overallStatusFieldId,
    evaluatorEmailFieldId, evaluatorEmailsByLevel, levelFields,
  };
}
