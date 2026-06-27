// The active JotForm API profile id (see backend lib/profiles.js). Was a fixed
// 'default'|'gdmo' toggle; now any profile id the backend exposes via
// GET /api/profiles. Kept as a string alias so existing imports still type-check.
export type JotformKeyType = string;

const ACTIVE_KEY = 'jotform_key_type';      // stores the active profile id
const PER_USER_KEY = 'jotform_key_choices'; // per-email profile choice

function readChoices(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PER_USER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Empty string = "let the backend pick its default profile".
export function getJotformKeyType(): JotformKeyType {
  return localStorage.getItem(ACTIVE_KEY) || '';
}

export function getJotformKeyTypeFor(email: string | null | undefined): JotformKeyType {
  if (!email) return getJotformKeyType();
  return readChoices()[email.toLowerCase()] || getJotformKeyType();
}

export function setJotformKeyType(value: JotformKeyType, email?: string | null) {
  localStorage.setItem(ACTIVE_KEY, value);
  if (email) {
    const choices = readChoices();
    choices[email.toLowerCase()] = value;
    localStorage.setItem(PER_USER_KEY, JSON.stringify(choices));
  }
  window.dispatchEvent(new CustomEvent('jotform-key-type-changed', { detail: value }));
}

export function jotformHeaders(): HeadersInit {
  const id = getJotformKeyType();
  // Send the profile id under the new header. When unset, omit it so the backend
  // falls back to its default profile.
  return id ? { 'x-jotform-profile-id': id } : {};
}
