export type JotformKeyType = 'default' | 'gdmo';

const ACTIVE_KEY = 'jotform_key_type';
const PER_USER_KEY = 'jotform_key_choices';

function readChoices(): Record<string, JotformKeyType> {
  try {
    const raw = localStorage.getItem(PER_USER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getJotformKeyType(): JotformKeyType {
  const v = localStorage.getItem(ACTIVE_KEY);
  return v === 'default' ? 'default' : 'gdmo';
}

export function getJotformKeyTypeFor(email: string | null | undefined): JotformKeyType {
  if (!email) return getJotformKeyType();
  const choice = readChoices()[email.toLowerCase()];
  return choice === 'default' ? 'default' : 'gdmo';
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
  return { 'x-jotform-key-type': getJotformKeyType() };
}
