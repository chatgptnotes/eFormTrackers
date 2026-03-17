import { Submission, ApprovalEntry, ApprovalLevel, WorkflowActionType } from '../types';
import { DetectedFields } from './formDiscovery';
import {
  WorkflowStep, WorkflowTaskInfo, ApproverConfig,
  getWorkflowTaskApprover, getConfiguredApprover,
} from './workflowCache';

// ─── Shared utilities ────────────────────────────────────────────────────────
/** Parse JotForm "YYYY-MM-DD HH:MM:SS" (UTC) or ISO 8601 string into a Date */
export function parseUTC(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}

/** Aging thresholds (days) for overallStatus classification */
const AGING_WARN_DAYS = 3;
const AGING_CRITICAL_DAYS = 7;
export function agingStatus(days: number): 'on-track' | 'delayed' | 'critical' {
  return days > AGING_CRITICAL_DAYS ? 'critical' : days > AGING_WARN_DAYS ? 'delayed' : 'on-track';
}

// ─── Field extractor ─────────────────────────────────────────────────────────
export function extractText(answer: unknown): string {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, string>;
    if (obj.first !== undefined || obj.last !== undefined)
      return [obj.first, obj.last].filter(Boolean).join(' ');
    if (obj.year && obj.month && obj.day)
      return `${obj.year}-${String(obj.month).padStart(2, '0')}-${String(obj.day).padStart(2, '0')}`;
    return Object.values(obj).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

export function getActionType(steps: WorkflowStep[], currentLevel: number | string): WorkflowActionType {
  if (typeof currentLevel !== 'number') return 'approval';
  const step = steps.find(s => s.level === currentLevel);
  return step?.type ?? 'approval';
}

// ─── Parse approver name/email from JotFlow action text ─────────────────────
// Action text format: "Action: Approved | By: Murali BK (bk@bettroi.com) | Via: JotFlow | Date: ..."
export function parseApproverFromActionText(text: string): { name: string; email: string } | null {
  if (!text) return null;
  // Pattern: "By: Name (email@domain.com)"
  const match = text.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  // Pattern: "By: Name |" (no email in parens)
  const nameOnly = text.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
  if (nameOnly) return { name: nameOnly[1].trim(), email: '' };
  return null;
}

// ─── Map any JotForm submission using heuristically-detected fields ───────────
export function mapGenericSubmission(
  raw: Record<string, unknown>,
  formId: string,
  formTitle: string,
  fields: DetectedFields,
  workflowSteps: WorkflowStep[] = [],
  workflowTasks: WorkflowTaskInfo[] = [],
  approverConfigs: ApproverConfig[] = [],
): Submission {
  const answers = (raw.answers as Record<string, { answer: unknown; text?: string }>) || {};
  const get = (id: string | null) => id ? extractText(answers[id]?.answer) : '';

  const requesterName = get(fields.nameFieldId);
  const email = get(fields.emailFieldId);
  const department = get(fields.deptFieldId) || 'General';
  const description = get(fields.descFieldId) || formTitle;
  const amount = get(fields.amountFieldId);
  const priorityRaw = (get(fields.priorityFieldId) || 'medium').toLowerCase();
  const priority = (['urgent', 'high', 'medium', 'low'].find(p => priorityRaw.includes(p)) || 'medium') as 'low' | 'medium' | 'high' | 'urgent';

  const history: ApprovalEntry[] = [];
  let currentLevel: ApprovalLevel | 'completed' | 'rejected' = 1 as ApprovalLevel;

  // Evaluator email from submission answers — single or per-level
  const evaluatorEmail = fields.evaluatorEmailFieldId ? get(fields.evaluatorEmailFieldId) : '';
  const getEvaluatorEmail = (level: number): string => {
    const perLevelFieldId = fields.evaluatorEmailsByLevel?.[level];
    if (perLevelFieldId) return get(perLevelFieldId);
    return evaluatorEmail; // fallback to single evaluator email
  };
  // Assignee email from workflow step configuration (set in form-workflow API)
  const getStepAssignee = (level: number): string => {
    const step = workflowSteps.find(s => s.level === level);
    return step?.assigneeEmail || '';
  };

  if (fields.levelFields.length > 0) {
    for (const lf of fields.levelFields) {
      const statusVal = get(lf.statusFieldId).toLowerCase();
      const rawApproverField = get(lf.approverFieldId);
      const parsed = parseApproverFromActionText(rawApproverField);
      const wfApprover = getWorkflowTaskApprover(workflowTasks, lf.level);
      const date = get(lf.dateFieldId) || undefined;

      if (statusVal === 'approved') {
        // APPROVED: use actual data — parsed action text, then raw field, then config as fallback
        const configApprover = getConfiguredApprover(approverConfigs, formId, lf.level);
        const approverName = parsed?.name || configApprover?.name || wfApprover?.name || getEvaluatorEmail(lf.level) || getStepAssignee(lf.level)
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = parsed?.email || configApprover?.email || wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'approved', date });
        const isLast = lf.level === fields.levelFields[fields.levelFields.length - 1].level;
        currentLevel = isLast ? 'completed' : (lf.level + 1) as ApprovalLevel;
      } else if (statusVal === 'rejected' || statusVal === 'denied') {
        const configApprover = getConfiguredApprover(approverConfigs, formId, lf.level);
        const approverName = parsed?.name || configApprover?.name || wfApprover?.name
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = parsed?.email || configApprover?.email || wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'rejected', date });
        currentLevel = 'rejected';
        break;
      } else {
        // PENDING: only use THIS submission's own data — don't inject guessed names from other submissions
        const approverName = wfApprover?.name || getEvaluatorEmail(lf.level) || getStepAssignee(lf.level)
          || (rawApproverField && !rawApproverField.includes('Action:') ? rawApproverField : '')
          || `Level ${lf.level} Approver`;
        const approverEmail = wfApprover?.email || '';
        history.push({ level: lf.level as ApprovalLevel, approverName, approverEmail, status: 'pending' });
        currentLevel = lf.level as ApprovalLevel;
        break;
      }
    }
  } else {
    // Single-level: read overall status field
    const overall = get(fields.overallStatusFieldId).toLowerCase();
    if (overall.includes('approved') || overall.includes('complet')) currentLevel = 'completed';
    else if (overall.includes('reject') || overall.includes('denied')) currentLevel = 'rejected';
    else currentLevel = 1 as ApprovalLevel;

    const wfApprover = getWorkflowTaskApprover(workflowTasks, 1);
    const histStatus = typeof currentLevel === 'number' ? 'pending' : currentLevel === 'completed' ? 'approved' : 'rejected';
    // For acted levels, use config. For pending, only use direct data.
    if (histStatus !== 'pending') {
      const configApprover = getConfiguredApprover(approverConfigs, formId, 1);
      history.push({ level: 1 as ApprovalLevel, approverName: configApprover?.name || wfApprover?.name || evaluatorEmail || getStepAssignee(1) || 'Approver', approverEmail: configApprover?.email || wfApprover?.email || '', status: histStatus });
    } else {
      history.push({ level: 1 as ApprovalLevel, approverName: wfApprover?.name || evaluatorEmail || getStepAssignee(1) || 'Approver', approverEmail: wfApprover?.email || '', status: 'pending' });
    }
  }

  // Overall status field can override level computation
  const overallFinal = get(fields.overallStatusFieldId).toLowerCase();
  if (overallFinal.includes('complet')) currentLevel = 'completed';
  else if (overallFinal.includes('reject')) currentLevel = 'rejected';

  const createdAt = (raw.created_at as string) || '';
  const submissionDate = createdAt ? parseUTC(createdAt) : new Date();
  const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

  const lastApproval = [...history].reverse().find(h => h.status === 'approved' && h.date);
  const levelStartDate = lastApproval?.date ? parseUTC(lastApproval.date) : submissionDate;
  const daysAtCurrentLevel = typeof currentLevel === 'number'
    ? Math.floor((Date.now() - levelStartDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const id = String(raw.id);
  const editLink = String(raw.edit_link || '');
  const actionType = getActionType(workflowSteps, currentLevel);
  const inboxUrl = `https://eforms.mediaoffice.ae/inbox/${formId}/${id}`;
  const prefix = formTitle.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'WF';

  const rawGenericStatus = get(fields.overallStatusFieldId);
  const genericJotformStatus = rawGenericStatus ||
    (currentLevel === 'completed' ? 'Completed' :
     currentLevel === 'rejected' ? 'Rejected' :
     history.some(h => h.status === 'approved') ? 'In Progress' : 'Pending');

  return {
    id,
    formId,
    formTitle,
    referenceNumber: `${prefix}-${id.slice(-6)}`,
    title: description,
    description: `${description}${amount ? ' — AED ' + amount : ''}`,
    editLink: editLink || undefined,
    actionType,
    taskUrl: inboxUrl,
    formUrl: inboxUrl,
    submittedBy: { name: requesterName || 'Unknown', department, email },
    submissionDate: submissionDate.toISOString().slice(0, 10),
    currentApprovalLevel: currentLevel,
    approvalHistory: history,
    daysAtCurrentLevel,
    totalDaysSinceSubmission: totalDays,
    overallStatus: agingStatus(daysAtCurrentLevel),
    jotformStatus: genericJotformStatus,
    priority,
    answers: { description, amount, department, email, requester: requesterName },
    levelFieldMap: fields.levelFields.length > 0
      ? fields.levelFields.map(lf => ({
          level: lf.level,
          statusFieldId: lf.statusFieldId,
          approverFieldId: lf.approverFieldId,
          overallStatusFieldId: fields.overallStatusFieldId,
        }))
      : fields.overallStatusFieldId
        ? [{ level: 1, statusFieldId: fields.overallStatusFieldId, approverFieldId: null, overallStatusFieldId: fields.overallStatusFieldId }]
        : undefined,
    pendingApproverName: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverName || undefined;
    })(),
    pendingApproverEmail: (() => {
      const pending = history.find(h => h.status === 'pending');
      return pending?.approverEmail || undefined;
    })(),
  };
}

