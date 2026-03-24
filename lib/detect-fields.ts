/**
 * detect-fields.ts
 *
 * Server-side level-field detection extracted from formDiscovery.ts.
 * Pure function — no browser APIs, no localStorage.
 * Used by webhook.ts to dynamically detect L1-L4 status/approver/date field IDs.
 */

export interface LevelFieldGroup {
  level: number;
  statusFieldId: string;
  approverFieldId: string | null;
  dateFieldId: string | null;
}

export interface DetectedLevelFields {
  overallStatusFieldId: string | null;
  evaluatorEmailsByLevel: Record<number, string>;
  levelFields: LevelFieldGroup[];
  nameFieldId: string | null;
  emailFieldId: string | null;
  descFieldId: string | null;
  deptFieldId: string | null;
  priorityFieldId: string | null;
  amountFieldId: string | null;
}

interface Question {
  qid?: string;
  text?: string;
  name?: string;
  type?: string;
}

/**
 * Detect level-specific fields, overall status, and evaluator emails
 * from a JotForm questions dictionary (as returned by GET /form/{id}/questions).
 */
export function detectLevelFields(
  questions: Record<string, Question>
): DetectedLevelFields {
  const list = Object.entries(questions)
    .map(([qid, q]) => ({ qid, ...q }))
    .sort((a, b) => parseInt(a.qid) - parseInt(b.qid));

  let overallStatusFieldId: string | null = null;
  let nameFieldId: string | null = null;
  let emailFieldId: string | null = null;
  let descFieldId: string | null = null;
  let deptFieldId: string | null = null;
  let priorityFieldId: string | null = null;
  let amountFieldId: string | null = null;
  const evaluatorEmailsByLevel: Record<number, string> = {};

  // level → { status, approver, date }
  const byLevel: Record<number, { s?: string; a?: string; d?: string }> = {};

  for (const q of list) {
    const raw = (q.text || q.name || '').trim();
    const lbl = raw.toLowerCase();
    const id = q.qid;

    // ── submitter name ──
    if (!nameFieldId && (
      q.type === 'control_fullname' ||
      lbl === 'name' || lbl.includes('full name') ||
      lbl.includes('requester') || lbl.includes('submitted by') ||
      lbl.includes('applicant') || lbl.includes('employee name')
    )) { nameFieldId = id; continue; }

    // ── email ──
    if (!emailFieldId && (
      q.type === 'control_email' || lbl.includes('email') || lbl.includes('e-mail')
    )) { emailFieldId = id; continue; }

    // ── per-level evaluator email ──
    const levelEmailMatch = lbl.match(/^(?:l|level)\s*(\d+)\s+(?:evaluator|approver|reviewer)\s+email$/);
    if (levelEmailMatch) {
      evaluatorEmailsByLevel[parseInt(levelEmailMatch[1])] = id;
      continue;
    }

    // ── department ──
    if (!deptFieldId && (
      lbl.includes('department') || lbl.includes('dept') ||
      lbl.includes('division') || lbl.includes('section')
    )) { deptFieldId = id; continue; }

    // ── description / title of request ──
    if (!descFieldId && (
      lbl.includes('description') || lbl.includes('subject') ||
      lbl.includes('purpose') || lbl.includes('request detail') ||
      lbl.includes('justification') || lbl.includes('title') ||
      (lbl.includes('detail') && !lbl.includes('date'))
    )) { descFieldId = id; continue; }

    // ── priority ──
    if (!priorityFieldId && lbl.includes('priority'))
    { priorityFieldId = id; continue; }

    // ── amount ──
    if (!amountFieldId && (
      lbl.includes('amount') || lbl.includes('budget') ||
      lbl.includes('cost') || lbl.includes('total') ||
      lbl.includes('value') || lbl.includes('price')
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

    // ── single-level approval status ──
    if (!overallStatusFieldId && !hasLevel && lbl.includes('approval') && lbl.includes('status'))
    { overallStatusFieldId = id; }
  }

  const levelFields: LevelFieldGroup[] = Object.entries(byLevel)
    .filter(([, f]) => !!f.s)
    .map(([lvl, f]) => ({
      level: parseInt(lvl),
      statusFieldId: f.s!,
      approverFieldId: f.a || null,
      dateFieldId: f.d || null,
    }))
    .sort((a, b) => a.level - b.level);

  return {
    overallStatusFieldId,
    evaluatorEmailsByLevel,
    levelFields,
    nameFieldId,
    emailFieldId,
    descFieldId,
    deptFieldId,
    priorityFieldId,
    amountFieldId,
  };
}
