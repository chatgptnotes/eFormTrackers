# Submitter & Pending-Approver Identification Strategy

> Across many JotForm forms with arbitrary field layouts, how do we reliably identify
> (a) who submitted a record and (b) with whom it is currently pending?
>
> Heuristic-only detection is the current default. It fails whenever a form designer
> uses non-canonical labels. Below is the layered fallback model that actually scales.

## The problem with heuristics alone

`frontend/src/services/formDiscovery.ts:detectFields()` scans each form's question
schema and assigns roles based on label matching:

| Role | Match conditions (current heuristic) |
|---|---|
| Submitter name | `type=control_fullname` OR label `name` / `full name` / `requester` / `submitted by` / `applicant` / `employee name` |
| Submitter email | `type=control_email` OR label includes `email` |
| Pending approver email | label includes `evaluator` / `approver email` / `reviewer email` / `assigned to` / `send to` |
| Per-level approver | regex `^L1 evaluator email$`, `^Level 2 approver email$` |
| Department | label includes `department` / `dept` / `division` |

If the designer labels the field `Naam`, `Sender`, `Requestor`, `Employee`, or anything
outside this list, detection silently fails. Result: dashboard shows "Approver"
placeholder, "Unknown" submitter, or skips identification entirely.

## Three-tier authoritative resolution

### Tier 1 — JotForm Workflow Engine API (authoritative)

`GET /form/{id}/workflow-instances/{subId}/tasks` returns the workflow definition's
actual assignees. Already implemented in `enrichWithWorkflowTasks()`:

```js
activeTask.assigneeName   // "Huzaifa Dawasaz"
activeTask.assigneeEmail  // "huzaifa.dawasaz@mediaoffice.ae"
activeTask.level          // 3
activeTask.type           // workflow_approval | workflow_assign_task | workflow_assign_form
```

**Why this is bulletproof**: no label matching, no field-position guessing. JotForm
itself returns the structured assignee for the active task. The mapper should treat
this as authoritative whenever the API returns an active task, and override any
heuristic-derived value.

**Coverage**: every form that has a workflow attached on JotForm side
(~95% of business forms). Excluded: simple data-collection forms with no workflow
(e.g. attendance logs).

### Tier 2 — SSO-bound submitter metadata

For JotForm Enterprise + Microsoft SSO submissions, the submitter's identity can be
captured at submission time via:

1. **Auto-fill placeholders** — form fields prefilled with `{user_email}`,
   `{user_fullname}` JotForm shortcodes (SSO must be active).
2. **Hidden read-only fields** named conventionally (e.g. `submitter_email`,
   `submitter_name`) populated from SSO.
3. **JotForm's `username` / `submitter` keys** on the submission payload itself
   (depends on form config).

**Implementation requirement**: form admin must enable SSO auto-fill and add the
hidden fields. The mapper then prefers these over the name/email heuristic.

### Tier 3 — Per-form manual approver-config override

Already implemented in `frontend/src/hooks/useApproverConfig.ts` and the
`approver_configs` table. Admin uses `ApproverConfigModal` to explicitly map for a
specific form:

- `submitter_name_field_id` → which qid is the submitter name
- `submitter_email_field_id` → which qid is the submitter email
- `approver_email_field_id` per level → which qid holds the level-N approver

This is the **100% override**: when Tier 1 & 2 fail (e.g. attendance form with no
workflow and no SSO fields), admin manually points to the right qids.

## Recommended resolution order

Mapper code should resolve in this order, falling through only when the higher tier
yields nothing:

```text
SUBMITTER
  1. SSO metadata field (submitter_email / username on payload)
  2. Manual approver-config mapping for this form
  3. Heuristic detectFields() result
  4. Empty / "Unknown" — never fabricate

PENDING APPROVER
  1. Workflow Engine activeTask (assigneeName + assigneeEmail)
  2. Manual approver-config mapping per current level
  3. Heuristic evaluatorEmailFieldId on the submission
  4. Mark as "No approver — non-workflow form" (do NOT show "Approver" placeholder)
```

## Concrete code changes required

1. **`submissionMappers.ts`**: today mapping runs first, then `enrichWithWorkflowTasks`
   overrides. Swap so workflow-task data is the primary source and mapping only fills
   gaps. Also: when no active task and no manual config, set `pendingApproverName =
   null` instead of the literal string "Approver".

2. **`enrichWithWorkflowTasks` priority**: when Tier 1 yields an assignee, it must
   NOT be overwritten later by `_mapped.levels` or heuristic data.

3. **Approver-config UX**: surface a warning in the dashboard for any form where
   submissions arrive but no Tier 1/2/3 hit exists — prompt admin to map fields.

4. **Form-template documentation**: publish a one-page guide for form designers
   showing canonical labels (`Email`, `Department`, `Approver Email`) and the SSO
   placeholder syntax. Reduces Tier 3 fallback usage.

## What this does NOT guarantee

- Public anonymous forms (no SSO, no workflow): submitter identity is best-effort
  from a `Name` dropdown. IP is corroborating evidence only.
- Forms whose workflow uses `Email` step (not `Approval` step): the next-step
  assignee is a notification target, not a decision-maker. Map accordingly in
  approver-config.
- Submissions older than the JotForm workflow-instance retention window: Tier 1 may
  return empty. Fall back to Tier 3.

---

_Decision log: 2026-05-22 — drafted while debugging the Attendance System form
(submission `6276993656711881596`) which has neither workflow nor SSO fields and
was therefore showing "Pending With: Approver" as a misleading placeholder._
