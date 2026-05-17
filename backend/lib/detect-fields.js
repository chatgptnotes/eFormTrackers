/**
 * Detect level-specific fields, overall status, and evaluator emails
 * from a JotForm questions dictionary (as returned by GET /form/{id}/questions).
 *
 * Ported from api/detect-fields.ts (unchanged logic, CommonJS).
 */
function detectLevelFields(questions) {
  const list = Object.entries(questions)
    .map(([qid, q]) => ({ qid, ...q }))
    .sort((a, b) => parseInt(a.qid) - parseInt(b.qid));

  let overallStatusFieldId = null;
  let nameFieldId = null;
  let emailFieldId = null;
  let descFieldId = null;
  let deptFieldId = null;
  let priorityFieldId = null;
  let amountFieldId = null;
  const evaluatorEmailsByLevel = {};
  const byLevel = {};

  for (const q of list) {
    const raw = (q.text || q.name || '').trim();
    const lbl = raw.toLowerCase();
    const id = q.qid;

    if (!nameFieldId && (
      q.type === 'control_fullname' ||
      lbl === 'name' || lbl.includes('full name') ||
      lbl.includes('requester') || lbl.includes('submitted by') ||
      lbl.includes('applicant') || lbl.includes('employee name')
    )) { nameFieldId = id; continue; }

    if (!emailFieldId && (
      q.type === 'control_email' || lbl.includes('email') || lbl.includes('e-mail')
    )) { emailFieldId = id; continue; }

    const levelEmailMatch = lbl.match(/^(?:l|level)\s*(\d+)\s+(?:evaluator|approver|reviewer)\s+email$/);
    if (levelEmailMatch) {
      evaluatorEmailsByLevel[parseInt(levelEmailMatch[1])] = id;
      continue;
    }

    if (!deptFieldId && (
      lbl.includes('department') || lbl.includes('dept') ||
      lbl.includes('division') || lbl.includes('section')
    )) { deptFieldId = id; continue; }

    if (!descFieldId && (
      lbl.includes('description') || lbl.includes('subject') ||
      lbl.includes('purpose') || lbl.includes('request detail') ||
      lbl.includes('justification') || lbl.includes('title') ||
      (lbl.includes('detail') && !lbl.includes('date'))
    )) { descFieldId = id; continue; }

    if (!priorityFieldId && lbl.includes('priority'))
    { priorityFieldId = id; continue; }

    if (!amountFieldId && (
      lbl.includes('amount') || lbl.includes('budget') ||
      lbl.includes('cost') || lbl.includes('total') ||
      lbl.includes('value') || lbl.includes('price')
    )) { amountFieldId = id; continue; }

    const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
    if (!overallStatusFieldId && !hasLevel && (
      lbl === 'status' || lbl === 'overall status' ||
      lbl === 'final status' || lbl === 'approval status' ||
      (lbl.includes('overall') && lbl.includes('status'))
    )) { overallStatusFieldId = id; continue; }

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
        if (!byLevel[lvl].s) byLevel[lvl].s = id;
      }
    }

    if (!overallStatusFieldId && !hasLevel && lbl.includes('approval') && lbl.includes('status'))
    { overallStatusFieldId = id; }
  }

  const levelFields = Object.entries(byLevel)
    .filter(([, f]) => !!f.s)
    .map(([lvl, f]) => ({
      level: parseInt(lvl),
      statusFieldId: f.s,
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

module.exports = { detectLevelFields };
