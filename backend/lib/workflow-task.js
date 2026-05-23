/**
 * Flatten a JotForm raw workflow task into the shape the frontend expects.
 *
 * Raw JotForm taskList items have deeply nested properties (element.type,
 * properties.assigneeUser.name, properties.assigneeEmail, etc.) — the
 * frontend WorkflowDetailsSidebar reads flat fields (name, type, assigneeName,
 * assigneeEmail, level, taskId, internalFormID, accessLink). This helper
 * bridges the two so both /api/workflow-tasks (live) and /api/admin/sync-all
 * (DB backfill) write the same shape.
 *
 * The optional second arg sets a derived `level` (1-based) when the raw task
 * doesn't carry properties.level — used by admin-sync where order in taskList
 * is the only level signal we have.
 */
function extractTask(t, derivedLevel) {
  const element = t.element || {};
  const props = t.properties || {};
  const assigneeUser = props.assigneeUser || {};
  const recipients = Array.isArray(props.recipients) ? props.recipients : [];
  const firstRecipient = recipients[0] || {};
  const result = t.result || {};
  const completedBy = t.completedBy || t.completed_by || {};
  const status = String(t.status || 'PENDING').toUpperCase();

  return {
    name: String(element.name || props.taskName || t.name || ''),
    type: String(element.type || ''),
    status,
    assigneeName: String(assigneeUser.name || firstRecipient.name || t.assignee_name || ''),
    assigneeEmail: String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee || ''),
    level: typeof props.level === 'number' ? props.level : (typeof derivedLevel === 'number' ? derivedLevel : 0),
    updatedAt: String(t.updated_at || ''),
    taskId: String(t.id || ''),
    internalFormID: String(element.internalFormID || element.resourceID || element.formID || props.formID || ''),
    accessLink: String(t.accessLink || props.accessLink || element.accessLink || ''),
    submittedBy: String(completedBy.name || result.submittedBy || result.completed_by ||
      (status === 'COMPLETED' ? (assigneeUser.name || firstRecipient.name || '') : '') || ''),
    submittedByEmail: String(completedBy.email || result.submittedByEmail || result.completed_by_email ||
      (status === 'COMPLETED' ? (props.assigneeEmail || assigneeUser.email || firstRecipient.email || '') : '') || ''),
  };
}

module.exports = { extractTask };
