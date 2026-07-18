const configuredHost = import.meta.env.VITE_JOTFORM_HOST || 'https://www.jotform.com';

export const JOTFORM_HOST = String(configuredHost).replace(/\/$/, '');
export const JOTFORM_LOGO_URL = `${JOTFORM_HOST}/enterprise/logo.png`;
export const JOTFORM_WORKSPACE_URL = `${JOTFORM_HOST}/myforms`;

export function jotformUrl(path = ''): string {
  if (!path) return JOTFORM_HOST;
  return `${JOTFORM_HOST}${path.startsWith('/') ? path : `/${path}`}`;
}

export function jotformInboxUrl(formId: string, submissionId: string, taskId?: string): string {
  const url = new URL(jotformUrl(`/inbox/${formId}/${submissionId}`));
  if (taskId) url.searchParams.set('taskID', taskId);
  return url.toString();
}
