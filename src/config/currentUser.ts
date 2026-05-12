import type { Submission } from '../types';

export interface UserConfig {
  name: string;
  role: string;
  approvalLevels: number[];
  nameMatches: string[];
  isAdmin?: boolean;
}

export const USER_CONFIGS: Record<string, UserConfig> = {
  'huzaifa.dawasaz@mediaoffice.ae': {
    name: 'Huzaifa Dawasaz',
    role: 'Level 1 Approver',
    approvalLevels: [1],
    nameMatches: ['huzaifa', 'dawasaz'],
  },
  'bk@bettroi.com': {
    name: 'Murali BK',
    role: 'Level 2 Approver',
    approvalLevels: [2],
    nameMatches: ['murali', 'bk'],
    isAdmin: true,  // bk is super-admin — can approve any level
  },
  'admin@bettroi.com': {
    name: 'Bettroi Admin',
    role: 'Admin',
    approvalLevels: [1, 2, 3, 4],
    nameMatches: [],
    isAdmin: true,
  },
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  name: 'User',
  role: 'Viewer',
  approvalLevels: [],
  nameMatches: [],
  isAdmin: false,
};

/**
 * Returns a UserConfig for the given email.
 * - If email is in USER_CONFIGS, returns that entry.
 * - Otherwise, builds a default Approver config from the email prefix,
 *   so new users are never silently locked out as a Viewer.
 *
 * TO ADD A NEW USER: add their email as a key in USER_CONFIGS above.
 */
export function getUserConfig(email: string | null | undefined): UserConfig {
  if (!email) return DEFAULT_USER_CONFIG;
  if (USER_CONFIGS[email]) return USER_CONFIGS[email];
  // Auto-generate from email prefix (e.g. "sarah.ali@mediaoffice.ae" → "Sarah Ali")
  // Default to Viewer with NO approval levels — only admins explicitly listed above get full access
  const prefix = email.split('@')[0];
  const name = prefix
    .split(/[._-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    name,
    role: 'Viewer',
    approvalLevels: [],
    nameMatches: [],
    isAdmin: false,
  };
}

export const CURRENT_USER = USER_CONFIGS['huzaifa.dawasaz@mediaoffice.ae'];

/**
 * Single source of truth for "can this user see this submission?" used by both
 * the submissions table (DirectorDashboard) and the sidebar workflow list (App/Layout).
 *
 * Rules (in order):
 * - `super_admin` orgRole OR `isAdmin: true` in USER_CONFIGS: sees every submission.
 *   No other role gets blanket visibility — every other user must justify access
 *   per submission via approval level or direct assignment.
 * - `viewer` orgRole or any user with no `approvalLevels` configured: only sees
 *   submissions assigned to them or submitted by them. Never sees others' work.
 * - Approver (has `approvalLevels`): sees completed/rejected items + pendings at
 *   their level + anything assigned/submitted by them.
 */
export function isSubmissionVisible(
  submission: Submission,
  userEmail: string | null | undefined,
  config: UserConfig,
  orgRole: string,
): boolean {
  // Only super_admin (or an explicit USER_CONFIGS admin) gets full visibility.
  if (orgRole === 'super_admin' || config.isAdmin) return true;

  const myEmail = userEmail?.toLowerCase();
  const pendingEntry = submission.approvalHistory?.find(a => a.status === 'pending');
  const isAssignedOrMine = !!myEmail && (
    submission.pendingApproverEmail?.toLowerCase() === myEmail ||
    submission.approvalHistory?.some(a => a.approverEmail?.toLowerCase() === myEmail) ||
    submission.submittedBy.email?.toLowerCase() === myEmail
  );

  const isViewer = orgRole === 'viewer';
  if (isViewer || config.approvalLevels.length === 0) {
    return isAssignedOrMine;
  }

  if (typeof submission.currentApprovalLevel !== 'number') return isAssignedOrMine;
  const atDirectorLevel = config.approvalLevels.includes(submission.currentApprovalLevel as number);
  const nameMatch = pendingEntry?.approverName && config.nameMatches.length > 0
    ? config.nameMatches.some(m => pendingEntry.approverName.toLowerCase().includes(m))
    : false;
  return atDirectorLevel || nameMatch || isAssignedOrMine;
}
