import type { Submission, WorkflowTask } from '../types';

export interface UserConfig {
  name: string;
  role: string;
}

/**
 * Derives a presentation-only display name + role label from an email.
 * No access control here — visibility is decided by isSubmissionVisible (orgRole + email participation).
 * e.g. "sarah.ali@mediaoffice.ae" → { name: "Sarah Ali", role: "User" }
 */
export function getUserConfig(email: string | null | undefined): UserConfig {
  if (!email) return { name: 'User', role: 'User' };
  const prefix = email.split('@')[0];
  const name = prefix
    .split(/[._-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return { name, role: 'User' };
}

/**
 * Single source of truth for "can this user see this submission?" used by both
 * the submissions table (DirectorDashboard) and the sidebar workflow list (App/Layout).
 *
 * Mirrors the backend visibility contract exactly. admin/super_admin see every
 * submission (full oversight). Everyone else only sees one they submitted, are
 * the pending approver of, appear in approvalHistory, or are a task assignee.
 */
export function isSubmissionVisible(
  submission: Submission,
  userEmail: string | null | undefined,
  role?: string | null,
): boolean {
  const r = role?.toLowerCase();
  if (r === 'admin' || r === 'super_admin') return true;

  const myEmail = userEmail?.toLowerCase();
  if (!myEmail) return false;

  return (
    submission.submittedBy.email?.toLowerCase() === myEmail ||
    submission.pendingApproverEmail?.toLowerCase() === myEmail ||
    submission.approvalHistory?.some(a => a.approverEmail?.toLowerCase() === myEmail) ||
    submission.workflowTasks?.some(t => t.assigneeEmail?.toLowerCase() === myEmail) ||
    submission.workflowTasks?.some(t => t.submittedByEmail?.toLowerCase() === myEmail) ||
    false
  );
}

/**
 * "Is this submission awaiting the logged-in user's action right now?"
 *
 * True when the user is the current pending approver, OR is assigned any ACTIVE
 * workflow task. The ACTIVE-task check is essential for parallel-approval steps:
 * one step can be assigned to several people at once, but the single
 * pendingApproverEmail column only names one of them — without this, the other
 * parallel approvers would never see the item.
 *
 * Role-agnostic by design: the Modern Dashboard applies the same rule to every
 * user (no admin "see everything" bypass).
 */
export function isAwaitingMyAction(
  submission: Submission,
  userEmail: string | null | undefined,
): boolean {
  const me = userEmail?.toLowerCase();
  if (!me) return false;
  if (submission.currentApprovalLevel === 'completed' || submission.currentApprovalLevel === 'rejected') {
    return false;
  }
  // Task list is authoritative when synced: I'm awaiting action only if I hold an
  // ACTIVE task. If tasks exist but none are mine-and-active (workflow advanced or
  // finished), a stale pendingApproverEmail must NOT keep it in my queue.
  const tasks = submission.workflowTasks || [];
  if (tasks.length > 0) {
    return tasks.some(t => String(t.status).toUpperCase() === 'ACTIVE' && t.assigneeEmail?.toLowerCase() === me);
  }
  // No task list synced — fall back to the single pending-approver field.
  return submission.pendingApproverEmail?.toLowerCase() === me;
}

/**
 * The action the logged-in user must take on this submission right now, derived
 * from their ACTIVE workflow task. Lets a card render the correct CTA instead of
 * always saying "Review & Approve":
 *   'approval' → Review & Approve (signature modal)
 *   'task'     → Open Task   (external JotForm task)
 *   'form'     → Fill Form   (external JotForm form)
 *   null       → no action for me (not assigned / already done)
 */
export function getMyActionType(
  submission: Submission,
  userEmail: string | null | undefined,
): 'approval' | 'task' | 'form' | null {
  const me = userEmail?.toLowerCase();
  if (!me) return null;
  if (submission.currentApprovalLevel === 'completed' || submission.currentApprovalLevel === 'rejected') {
    return null;
  }
  const tasks = submission.workflowTasks || [];
  const active = tasks.find(
    t => String(t.status).toUpperCase() === 'ACTIVE' && t.assigneeEmail?.toLowerCase() === me,
  );
  if (!active) {
    // Only trust the single pending-approver field when NO task list is synced.
    if (tasks.length === 0 && submission.pendingApproverEmail?.toLowerCase() === me) return 'approval';
    return null;
  }
  switch (String(active.type)) {
    case 'workflow_assign_task': return 'task';
    case 'workflow_assign_form': return 'form';
    case 'workflow_approval': return 'approval';
    default: return 'approval';
  }
}

/** Map a single workflow task to a human role label for the logged-in user. */
function labelForTask(t: WorkflowTask): string {
  switch (String(t.type || '')) {
    case 'workflow_approval': return t.level ? `Level ${t.level} Approver` : 'Approver';
    case 'workflow_assign_task': return 'Task Assignee';
    case 'workflow_assign_form': return 'Form Filler';
    default: return t.level ? `Level ${t.level} Approver` : 'Participant';
  }
}

/**
 * The logged-in user's role *within this specific workflow* — derived from the
 * JotForm workflow data, so the same person can be a different role in different
 * workflows. Presentation-only (no access control — that's isSubmissionVisible).
 * Returns null when the user doesn't personally participate (e.g. an admin
 * viewing someone else's workflow) so the caller renders nothing.
 *
 * Priority: their ACTIVE task (current obligation) → any task they're assigned →
 * pending approver → past approval-history entry → submitter.
 */
export function getMyWorkflowRole(
  submission: Submission,
  userEmail: string | null | undefined,
): string | null {
  const me = userEmail?.toLowerCase();
  if (!me) return null;

  const myTasks = (submission.workflowTasks || []).filter(
    t => t.assigneeEmail?.toLowerCase() === me,
  );
  if (myTasks.length > 0) {
    const active = myTasks.find(t => String(t.status).toUpperCase() === 'ACTIVE');
    return labelForTask(active || myTasks[0]);
  }

  if (submission.pendingApproverEmail?.toLowerCase() === me) {
    return typeof submission.currentApprovalLevel === 'number'
      ? `Level ${submission.currentApprovalLevel} Approver`
      : 'Approver';
  }

  const histEntry = submission.approvalHistory?.find(
    a => a.approverEmail?.toLowerCase() === me,
  );
  if (histEntry) return histEntry.level ? `Level ${histEntry.level} Approver` : 'Approver';

  if (submission.submittedBy.email?.toLowerCase() === me) return 'Submitter';

  return null;
}
