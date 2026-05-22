/**
 * Page-level access allowlists.
 *
 * Keep this list narrow — adding an email here grants full access to the
 * Settings page (JotForm API key, form discovery, auto-approve rules, etc).
 */
export const SETTINGS_ALLOWED_EMAILS: ReadonlyArray<string> = ['bk@bettroi.com'];

export function canAccessSettings(email: string | null | undefined): boolean {
  if (!email) return false;
  return SETTINGS_ALLOWED_EMAILS.includes(email.toLowerCase());
}
