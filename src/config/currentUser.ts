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
