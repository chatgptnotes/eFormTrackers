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
  const elementAssignees = Array.isArray(element.assignee) ? element.assignee : [];
  const firstElementAssignee = elementAssignees[0] || {};
  const result = t.result || {};
  const completedBy = t.completedBy || t.completed_by || {};
  const status = String(t.status || 'PENDING').toUpperCase();
  const internalFormID = String(element.internalFormID || element.resourceID || element.formID || props.formID || '');
  const rawType = String(element.type || '');

  return {
    name: String(element.name || props.taskName || t.name || ''),
    type: rawType,
    status,
    assigneeName: String(assigneeUser.name || firstRecipient.name || firstElementAssignee.text || t.assignee_name || ''),
    assigneeEmail: String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || firstElementAssignee.value || firstElementAssignee.text || t.assignee || ''),
    level: typeof props.level === 'number' ? props.level : (typeof derivedLevel === 'number' ? derivedLevel : 0),
    updatedAt: String(t.updated_at || ''),
    taskId: String(t.id || ''),
    internalFormID,
    accessLink: String(t.accessLink || props.accessLink || element.accessLink || ''),
    submittedBy: String(completedBy.name || result.submittedBy || result.completed_by ||
      (status === 'COMPLETED' ? (assigneeUser.name || firstRecipient.name || '') : '') || ''),
    submittedByEmail: String(completedBy.email || result.submittedByEmail || result.completed_by_email ||
      (status === 'COMPLETED' ? (props.assigneeEmail || assigneeUser.email || firstRecipient.email || firstElementAssignee.value || firstElementAssignee.text || '') : '') || ''),
    // Approval-step signature: when an approver signs while approving a task,
    // JotForm stores the signature URL in properties.signature.value. This is
    // separate from form-field (control_signature) signatures in answers.
    signatureUrl: String(props.signature?.value || props.signature || ''),
  };
}

function taskListFromResponse(data) {
  const content = data?.content;
  if (Array.isArray(content?.taskList)) return content.taskList;
  if (Array.isArray(content)) {
    if (content.length === 1 && Array.isArray(content[0]?.taskList)) return content[0].taskList;
    return content;
  }
  return [];
}

/**
 * Derive the authoritative submission status from the workflow engine, using the
 * instance's own status string and/or its (flattened) task list — NOT the form's
 * status dropdown fields, which are frequently blank on workflow-engine forms and
 * leave rows stuck at "pending" after the workflow has actually finished.
 *
 * @param {string} workflowStatus  instance status from JotForm (COMPLETED, REJECTED, ACTIVE, …)
 * @param {Array}  flatTasks       tasks already run through extractTask()
 * @returns {'completed'|'rejected'|'pending'|null}  null = no authoritative
 *          signal; caller should keep its form-field fallback.
 */
function deriveWorkflowStatus(workflowStatus, flatTasks = []) {
  const ws = String(workflowStatus || '').toUpperCase();
  if (ws === 'COMPLETED' || ws === 'COMPLETE') return 'completed';
  if (ws === 'REJECTED' || ws === 'CANCELLED' || ws === 'DECLINED') return 'rejected';
  if (ws === 'NOT_STARTED') return 'completed';

  const tasks = Array.isArray(flatTasks) ? flatTasks : [];
  if (tasks.length > 0) {
    const anyActive = tasks.some(t => String(t.status).toUpperCase() === 'ACTIVE');
    if (anyActive) return 'pending';
    const anyPending = tasks.some(t => String(t.status).toUpperCase() === 'PENDING');
    if (anyPending) return 'pending';
    const anyFailed = tasks.some(t => ['CANCELED', 'CANCELLED', 'FAILED'].includes(String(t.status).toUpperCase()));
    if (anyFailed) return 'rejected';
    const endDone = tasks.some(t => String(t.type) === 'workflow_end_point' && String(t.status).toUpperCase() === 'COMPLETED');
    const allDone = tasks.every(t => String(t.status).toUpperCase() === 'COMPLETED');
    if (endDone || allDone) return 'completed';
    return 'completed';
  }

  if (ws === 'ACTIVE' || ws === 'PENDING' || ws === 'INPROGRESS' || ws === 'IN_PROGRESS') return 'pending';
  return null;
}

/**
 * SQL expression for `workflow_tasks = ...` in an ON CONFLICT DO UPDATE.
 * Merges the incoming task array (bind param, e.g. '$21') with the existing
 * row: when an incoming non-assign-form task's accessLink is empty but the
 * stored task (same taskId) has one, the stored link is kept. Assign-form tasks
 * only keep stored /prefill/ URLs; old email-harvested links are deprecated.
 */
function mergeWorkflowTasksSql(param) {
  return `(
    SELECT COALESCE(jsonb_agg(
      CASE WHEN COALESCE(nt->>'accessLink','') = '' AND COALESCE(ot.link,'') <> ''
                AND (nt->>'type' = 'workflow_approval'
                  OR (nt->>'type' = 'workflow_assign_task'
                    AND COALESCE(nt->>'internalFormID','') <> ''
                    AND (ot.link LIKE '%/share/%' OR ot.link LIKE '%/approval-form/%'))
                  OR (nt->>'type' = 'workflow_assign_form' AND ot.link LIKE '%/prefill/%'))
           THEN jsonb_set(nt, '{accessLink}', to_jsonb(ot.link))
           ELSE nt END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(${param}::jsonb) nt
    LEFT JOIN LATERAL (
      SELECT t->>'accessLink' AS link
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(jf_submissions.workflow_tasks) = 'array'
             THEN jf_submissions.workflow_tasks ELSE '[]'::jsonb END
      ) t
      WHERE t->>'taskId' = nt->>'taskId' AND COALESCE(t->>'accessLink','') <> ''
      LIMIT 1
    ) ot ON true
  )`;
}

module.exports = { extractTask, taskListFromResponse, deriveWorkflowStatus, mergeWorkflowTasksSql };
