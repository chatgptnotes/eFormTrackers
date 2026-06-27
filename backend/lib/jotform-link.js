const env = require('../config/env');

function safeUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(String(rawUrl).trim());
    const allowedHost = new URL(env.JOTFORM_HOST).host;
    if (url.host !== allowedHost) return null;
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
    out.linkType = url.searchParams.get('workflowAssignFormTask') ? 'assign-form' : 'form';
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

function normalizeTaskLink(rawUrl, task = {}) {
  const parsed = parseJotformTaskLink(rawUrl);
  if (!parsed.normalizedUrl) return parsed;

  const taskFormId = parsed.taskFormId || String(task.internalFormID || task.formId || '');
  const taskId = parsed.taskId || String(task.taskId || '');
  let normalizedUrl = parsed.normalizedUrl;

  if (parsed.linkType === 'share' && taskFormId && taskId && parsed.shareToken) {
    normalizedUrl = buildApprovalFormUrl({ taskFormId, taskId, token: parsed.shareToken });
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
  return {
    approvalUrl: parsed.normalizedUrl || url || '',
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
  linkResponse,
};
