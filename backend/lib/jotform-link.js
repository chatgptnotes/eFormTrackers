const env = require('../config/env');

function safeUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(String(rawUrl).trim());
    const allowedHost = new URL(env.JOTFORM_HOST).host;
    const isJotformHost = url.hostname === 'jotform.com' || url.hostname.endsWith('.jotform.com');
    if (url.protocol !== 'https:' || (url.host !== allowedHost && !isJotformHost)) return null;
    return url;
  } catch {
    return null;
  }
}

function parseJotformTaskLink(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return {
      linkType: 'unknown',
      rawUrl: String(rawUrl || ''),
      normalizedUrl: '',
      taskFormId: '',
      taskId: '',
      prefillId: '',
      accessToken: '',
      shareToken: '',
      submissionId: '',
    };
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const out = {
    linkType: 'jotform',
    rawUrl: String(rawUrl || ''),
    normalizedUrl: url.toString(),
    taskFormId: '',
    taskId: '',
    prefillId: '',
    accessToken: '',
    shareToken: '',
    submissionId: '',
  };

  if (parts[0] === 'approval-form') {
    out.linkType = 'approval-form';
    out.taskFormId = parts[1] || '';
    const taskIdx = parts.indexOf('task');
    const tokenIdx = parts.indexOf('access-token');
    out.taskId = taskIdx >= 0 ? parts[taskIdx + 1] || '' : '';
    out.accessToken = tokenIdx >= 0 ? decodeURIComponent(parts[tokenIdx + 1] || '') : '';
    return out;
  }

  if (parts[1] === 'prefill') {
    out.linkType = 'prefill';
    out.taskFormId = parts[0] || '';
    out.prefillId = parts[2] || '';
    out.taskId = url.searchParams.get('taskID') || url.searchParams.get('taskId') || '';
    return out;
  }

  if (parts[0] === 'share') {
    out.linkType = 'share';
    out.shareToken = decodeURIComponent(parts[1] || '');
    out.taskId = url.searchParams.get('taskID') || url.searchParams.get('taskId') || '';
    return out;
  }

  if (parts[0] === 'inbox') {
    out.linkType = 'inbox';
    out.taskFormId = parts[1] || '';
    out.submissionId = parts[2] || '';
    out.taskId = url.searchParams.get('taskID') || url.searchParams.get('taskId') || '';
    return out;
  }

  if (/^\d+$/.test(parts[0] || '')) {
    out.linkType = url.searchParams.get('workflowAssignFormTask') ? 'assign-form'
      : url.searchParams.get('workflowAssignTask') ? 'assign-task'
        : url.searchParams.get('workflowApprovalTask') ? 'approval-task'
          : 'form';
    out.taskFormId = parts[0] || '';
    out.taskId = url.searchParams.get('taskID') || url.searchParams.get('taskId') || '';
    return out;
  }

  return out;
}

function buildApprovalFormUrl({ taskFormId, taskId, token }) {
  if (!taskFormId || !taskId || !token) return '';
  return `${env.JOTFORM_HOST}/approval-form/${taskFormId}/task/${taskId}/access-token/${encodeURIComponent(token)}`;
}

function buildWorkflowTaskUrl(task = {}, formId = '') {
  const parsed = parseJotformTaskLink(task.accessLink);
  const type = String(task.type || '');
  const taskId = String(task.taskId || parsed.taskId || '');

  if (type === 'workflow_assign_task') {
    const taskFormId = String(parsed.linkType === 'approval-form' ? parsed.taskFormId : task.internalFormID || '');
    const token = parsed.accessToken || parsed.shareToken || tokenFromLink(task.accessLink);
    return buildApprovalFormUrl({ taskFormId, taskId, token });
  }

  const taskFormId = String(parsed.taskFormId || task.internalFormID || formId || '');
  if (!taskFormId) return '';

  if (type === 'workflow_assign_form') {
    if (parsed.prefillId) {
      return `${env.JOTFORM_PREFILL_HOST}/${taskFormId}/prefill/${parsed.prefillId}?workflowAssignFormTask=1&taskID=${taskId}`;
    }
    return '';
  }
  if (type === 'workflow_approval') {
    const token = parsed.accessToken || parsed.shareToken || tokenFromLink(task.accessLink);
    return buildApprovalFormUrl({ taskFormId, taskId, token })
      || (taskId ? `${env.JOTFORM_HOST}/${taskFormId}?workflowApprovalTask=1&taskID=${taskId}` : `${env.JOTFORM_HOST}/${taskFormId}`);
  }
  return `${env.JOTFORM_HOST}/${taskFormId}`;
}

function applyResourceShareLinks(tasks = [], resourceShares = [], formId = '') {
  const tokens = new Map(resourceShares
    .filter(share => String(share.status || '').toUpperCase() === 'ACTIVE' && share.token)
    .map(share => [String(share.resource_id || ''), String(share.token)]));
  for (const task of tasks) {
    const token = tokens.get(String(task.taskId || ''));
    if (!token || !['workflow_assign_task', 'workflow_approval'].includes(String(task.type || ''))) continue;
    task.accessLink = buildWorkflowTaskUrl({ ...task, accessLink: `${env.JOTFORM_HOST}/share/${encodeURIComponent(token)}` }, formId);
  }
  return tasks;
}

function tokenFromLink(rawUrl) {
  const match = String(rawUrl || '').match(/\/access-token\/([^?#]+)/) || String(rawUrl || '').match(/\/share\/([^?#]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function pickShareLink(rows, taskToken = '', taskId = '') {
  const wantedToken = String(taskToken || '');
  const wantedTaskId = String(taskId || '');
  let newest = '';
  for (const row of rows) {
    for (const link of Array.isArray(row.action_links) ? row.action_links : []) {
      const url = String(link?.url || '');
      if ((!url.includes('/share/') && !url.includes('/approval-form/')) || String(link?.type || '').toLowerCase() === 'reject') continue;
      if (wantedToken && tokenFromLink(url) === wantedToken) return url;
      if (wantedTaskId && String(link?.taskId || '') === wantedTaskId) return url;
      if (!newest) newest = url;
    }
  }
  return wantedToken || wantedTaskId ? '' : newest;
}

function normalizeTaskLink(rawUrl, task = {}) {
  const parsed = parseJotformTaskLink(rawUrl);
  if (!parsed.normalizedUrl) return parsed;
  // `task.formId` is usually the parent submission form. Only an explicit
  // internalFormID may replace the task-form ID carried by an email URL.
  const contextTaskFormId = String(task.internalFormID || '');
  let taskFormId = parsed.taskFormId || contextTaskFormId;
  const taskId = parsed.taskId || String(task.taskId || '');
  let normalizedUrl = parsed.normalizedUrl;

  const configuredHost = new URL(env.JOTFORM_HOST).host;
  const sourceHost = new URL(parsed.normalizedUrl).host;
  if (parsed.linkType === 'share' && sourceHost === configuredHost && taskFormId && taskId && parsed.shareToken) {
    normalizedUrl = buildApprovalFormUrl({ taskFormId, taskId, token: parsed.shareToken });
  }

  if (
    parsed.linkType === 'approval-form' &&
    contextTaskFormId &&
    parsed.taskFormId &&
    contextTaskFormId !== parsed.taskFormId &&
    taskId &&
    parsed.accessToken
  ) {
    taskFormId = contextTaskFormId;
    normalizedUrl = buildApprovalFormUrl({ taskFormId, taskId, token: parsed.accessToken });
  }

  return {
    ...parsed,
    taskFormId,
    taskId,
    normalizedUrl,
  };
}

function linkResponse({ url, source, formId, submissionId, task = {} }) {
  const parsed = normalizeTaskLink(url, task);
  let approvalUrl = parsed.normalizedUrl || url || '';
  if (parsed.linkType === 'share' && approvalUrl) {
    const shareUrl = new URL(approvalUrl);
    const workspaceUrl = new URL(env.JOTFORM_HOST);
    if (shareUrl.host !== workspaceUrl.host) {
      shareUrl.protocol = workspaceUrl.protocol;
      shareUrl.host = workspaceUrl.host;
      approvalUrl = shareUrl.toString();
    }
  }
  return {
    approvalUrl,
    source,
    linkType: parsed.linkType,
    formId: String(formId || ''),
    submissionId: String(submissionId || ''),
    taskId: parsed.taskId || String(task.taskId || ''),
    taskFormId: parsed.taskFormId || String(task.internalFormID || ''),
  };
}

module.exports = {
  parseJotformTaskLink,
  normalizeTaskLink,
  buildApprovalFormUrl,
  buildWorkflowTaskUrl,
  applyResourceShareLinks,
  tokenFromLink,
  pickShareLink,
  linkResponse,
};
