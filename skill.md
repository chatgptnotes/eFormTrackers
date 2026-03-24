# JotFlow — Pending With Column Logic

## How "Pending With" Data is Determined

The "Pending With" column shows who currently needs to act on a submission. The data comes from a **two-pass enrichment system** where the second pass (workflow instance API) is the authoritative source.

---

## Pass 1: First Pass — Form Field Mapping (`mapGenericSubmission`)

**File:** `src/hooks/useSubmissions.ts` → `mapGenericSubmission()`

For forms WITH approval status dropdown fields:
1. Reads each level's status field value (e.g., "Approved", "Rejected", "Pending")
2. For pending levels, resolves approver name via priority chain:
   ```
   wfApprover?.name (from workflow tasks — empty in first pass)
   → getEvaluatorEmail(level) (from form's evaluator email field)
   → getStepAssignee(level) (from form-workflow API step config)
   → rawApproverField (from form's approver text field)
   → "Level X Approver" (fallback — renders as "Approval Pending" in amber)
   ```

For forms WITHOUT status fields (e.g., New Customer Registration Form):
- Falls through to single-level else branch
- Defaults to `currentApprovalLevel = 1` (pending at L1)
- Shows "Approver" / "Approval Pending" as placeholder

### Dynamic Approver Detection (also in first pass)
Before mapping, scans ALL submissions across all forms to build a live approver map:
- For each form+level, finds the most recent person who approved/rejected
- Uses that person's name+email for pending submissions at the same form+level
- This is a **best guess** — it assumes the same person handles all submissions at that level
- Merged with manual configs from `jf_approver_config` Supabase table (admin overrides win)

---

## Pass 2: Second Pass — Workflow Instance API (AUTHORITATIVE)

**File:** `src/hooks/useSubmissions.ts` → second pass block (line ~573)
**API:** `api/workflow-tasks.ts` → two-step chain

Runs for up to **50 pending submissions** (where `currentApprovalLevel` is a number).

### API Chain
```
GET /submission/{id}?addWorkflowStatus=1
  → extracts workflowInstanceID from response
GET /workflow/instance/{workflowInstanceID}
  → returns taskList with nested structure:
    - element.name → step name ("Approve & Sign", "review Task", "Form")
    - properties.assigneeUser.name → assignee name ("Murali")
    - properties.assigneeEmail → assignee email ("bk@bettroi.com")
    - status → "COMPLETED" | "ACTIVE" | "PENDING"
```

### Logic Applied
```
if ALL tasks are COMPLETED:
  → currentApprovalLevel = 'completed'
  → pendingApproverName = undefined
  → jotformStatus = 'Completed'
  → approvalHistory rebuilt with all tasks as 'approved'

else if ACTIVE task found:
  → currentApprovalLevel = activeTask.level
  → pendingApproverName = activeTask.assigneeName
  → pendingApproverEmail = activeTask.assigneeEmail
  → actionType = detected from step name:
      - includes 'task'/'review task' → 'task'
      - includes 'form'/'view form' → 'form'
      - else → 'approval'
  → jotformStatus = "{activeTask.name} Pending"
  → approvalHistory rebuilt from all tasks (COMPLETED → approved, rest → pending)
```

### Cache
- Client-side: 5-minute TTL per submissionId (`workflowTaskCache`)
- Batch limit: 50 submissions max per load cycle

---

## Pass 3: Rendering — `PendingWithCell` Component

**File:** `src/pages/DirectorDashboard.tsx` → `PendingWithCell`

```
if currentApprovalLevel === 'completed' → green "Completed" badge
if currentApprovalLevel === 'rejected' → red "Rejected" badge

Find pending history entry at current level:
  if no pending entry found → show "--"

  if approverName matches "Level X Approver" or "Approver" → generic fallback
    → shows amber "Approval Pending" / "Task Pending" / "Form Review Pending"

  if approverName is an email → split at @ for display name

  else → shows real name + email:
    → Name in white text (e.g., "Murali")
    → Email in gray text below (e.g., "bk@bettroi.com")
    → "Level X · Approval/Task/Form Review" label
    → Icon: purple person (approval), gold clipboard (task), blue form (form review)
```

---

## What's Dynamic vs Guessed

| Source | What it provides | Dynamic? |
|--------|-----------------|----------|
| Second pass (workflow instance API) | Real assignee name + email from JotForm workflow engine | **YES — fully dynamic** |
| Dynamic approver detection (first pass) | Most recent approver from other submissions | Semi-dynamic (guessed from patterns) |
| Form field values (first pass) | Status text from dropdown fields | Only for forms with status fields |
| Manual approver config (Supabase) | Admin-configured approver per form+level | Static config |
| Fallback | "Level X Approver" → renders as "Approval Pending" | Not dynamic |

**The second pass ALWAYS overrides the first pass** for any submission it processes.

---

## Supabase Sync

After both passes complete, ALL enriched submissions are synced to Supabase via fire-and-forget `POST /api/sync-to-supabase`. This means `jf_submissions` table always has the latest:
- `pending_approver_name` / `pending_approver_email`
- `current_level` / `status` / `jotform_status`
- `level_history` (full approval history array)

---

## Key Files Reference

| File | Lines | What |
|------|-------|------|
| `src/hooks/useSubmissions.ts:189-353` | `mapGenericSubmission()` | First pass field mapping |
| `src/hooks/useSubmissions.ts:513-553` | Dynamic approver detection | Scans submissions for approver patterns |
| `src/hooks/useSubmissions.ts:573-648` | Second pass workflow enrichment | Real workflow data override |
| `src/hooks/useSubmissions.ts:649-685` | Supabase sync | Fire-and-forget push to Supabase |
| `api/workflow-tasks.ts` | Full file | Two-step JotForm workflow API chain |
| `src/pages/DirectorDashboard.tsx:35-118` | `PendingWithCell` | Renders the Pending With column |
| `src/pages/DirectorDashboard.tsx:120-145` | `WorkflowStatusBadge` | Renders the Status column |
| `api/workflow-action.ts` | Full file | Approve/reject/complete workflow tasks via JotForm engine |
| `src/components/SubmissionModal.tsx:117-255` | `handleApproval` | Modal approve/reject flow with signature |
| `src/pages/DirectorDashboard.tsx:303-315` | `pushToJotForm` | Inline approve/reject from table row |

---

## Workflow Action Logic (Approve & Sign / Reject)

### How Approve/Reject Works from JotFlow

JotFlow can approve, reject, or complete workflow tasks **directly** without going to JotForm, using the discovered endpoint `POST /workflow/task/{taskId}/complete`.

### API Endpoint: `/api/workflow-action`

**File:** `api/workflow-action.ts`

**Request:** `POST /api/workflow-action`
```json
{
  "submissionId": "6494701286017427856",
  "action": "approve",        // "approve" | "reject" | "complete"
  "comment": "Looks good",    // optional
  "signature": "data:image/png;base64,..." // required for "Approve & Sign" steps
}
```

**Internal flow:**
```
1. GET /submission/{submissionId}?addWorkflowStatus=1
   → Extract workflowInstanceID

2. GET /workflow/instance/{workflowInstanceID}
   → Get taskList array

3. Find task where status === "ACTIVE"
   → Read element.type and element.outcomes[]

4. Map action to outcomeID:
   - action="approve" → find outcome with type="APPROVE" → outcomeID (usually 1)
   - action="reject"  → find outcome with type="DENY"    → outcomeID (usually 2)
   - action="complete" → use first outcome                → outcomeID (usually 1)

5. POST /workflow/task/{taskId}/complete
   Body: { outcomeID, comment?, signature? }
   → JotForm workflow engine advances the task
   → Next task becomes ACTIVE (or workflow completes)
```

### Task Types and Their Outcomes

| Task Type | Element Type | Available Outcomes | Signature Required? |
|-----------|-------------|-------------------|-------------------|
| Approve & Sign | `workflow_approval` | Approve (1, green) / Deny (2, red) | **YES** |
| Task / Review | `workflow_assign_task` | Complete (1, blue) | No |
| Form | `workflow_assign_form` | Complete (1, blue) | No |

### Frontend Flow

**From SubmissionModal (full flow with signature):**
```
User opens modal → draws signature → adds comment → clicks "Approve & Sign"
  → Two-click confirmation ("Are you sure?")
  → Upload signature to Supabase Storage (gets public URL)
  → POST /api/workflow-action { submissionId, action, comment, signature }
  → On success: optimistic UI update + Supabase cache update
  → Auto-refresh after 3s picks up new workflow state from JotForm
```

**From DirectorDashboard table (quick action):**
```
User clicks "Review & Approve" → opens modal (same flow above)
User clicks "Reject" → confirm → POST /api/workflow-action { action: "reject" }
```

### Key Points

- **Signature is mandatory** for "Approve & Sign" workflow steps — JotForm returns 400 "Signature not found" without it
- The modal always shows "Approve & Sign" and "Reject" buttons for ALL forms — no "Open in JotForm" fallback
- Form field updates (via `/api/jotform-update`) are kept as best-effort backup for forms that have status dropdown fields
- After workflow action succeeds, dashboard auto-refreshes and the second pass picks up the new workflow state
- If a task type doesn't support rejection (e.g., assign_task), the API returns an error explaining why

---

## Approve & Sign — Full API Chain (from JotFlow)

When a user clicks "Approve & Sign" in JotFlow, three APIs are called in sequence:

### Step 1: `POST /api/upload-signature` (20s timeout)
- Sends signature image (base64) + submissionId, level, comment, approverName
- Stores in Supabase Storage bucket `signatures`
- Returns `signatureUrl` (public URL)
- If this fails, approval is aborted with error message

### Step 2: `POST /api/workflow-action` (30s timeout — added 2026-03-17)
The **main API** that advances the JotForm workflow. Server-side chains 3 JotForm API calls:
```
1. GET  /submission/{submissionId}?addWorkflowStatus=1 → workflowInstanceID
2. GET  /workflow/instance/{instanceId} → taskList → find ACTIVE task
3. POST /workflow/task/{taskId}/complete → { outcomeID, comment, signature }
```
- `taskId` is now validated before URL construction (Fix 10, 2026-03-17)
- outcomeID mapping: approve → APPROVE type (1), reject → DENY type (2)

### Step 3: `POST /api/jotform-update` (backup, 20s timeout)
- Updates form hidden fields: L{n} Status = "Approved", Overall Status = "In Progress"/"Completed"
- Best-effort backup — only runs if form has status dropdown fields
- Uses `/api/jotform-update` (NOT `/api/jotform` proxy)

### Step 4: Supabase update (fire-and-forget)
- Updates `jf_submissions` table: `current_level`, `status`, `approver_name`, `last_synced`

### Post-action
- Optimistic UI update (instant feedback)
- Auto-refresh after 3s picks up new workflow state from second pass

---

## Fixes Applied (2026-03-17)

### Changes That Affect Approve/Sign Flow
| Fix | What Changed | Impact |
|-----|-------------|--------|
| **Fix 7** | Added 30s AbortController timeout to `/api/workflow-action` fetch | Previously could hang forever. Now shows "Workflow action timed out" |
| **Fix 10** | Added `if (!taskId)` guard in `api/workflow-action.ts` | Returns clear error instead of broken URL if task has no ID |
| **Fix 8** | CORS default changed to production domain | Local dev needs `ALLOWED_ORIGIN=*` in env |

### Changes That Do NOT Affect Approve/Sign Flow
| Fix | Why Safe |
|-----|---------|
| **Fix 9** (path allowlist on `/api/jotform`) | Approve/sign uses `/api/workflow-action`, `/api/upload-signature`, `/api/jotform-update` — none go through the jotform proxy |
| **Fix 1** (error banner) | Additive UI only |
| **Fix 2** (operator precedence) | Only affects `api/ensure-fields.ts` — field detection, not approval |
| **Fix 3** (clear caches on logout) | Only runs on sign-out |
| **Fix 4, 5, 6, 11, 12** (dead code removal) | Removed unused code only |

---

## "Assigned to Me" Filter

**File:** `src/pages/DirectorDashboard.tsx`

### UI
- Toggle button next to the search bar in the Director Dashboard header
- When active: gold background (`bg-gold text-navy-dark`), filters table
- When inactive: dark background, shows all submissions
- Icon: `UserCheck` from lucide-react

### Filter Logic
When toggled ON, filters `directorSubmissions` to show only submissions where the logged-in user is the pending approver:

```
Match criteria (any one = included):
1. sub.pendingApproverEmail matches user.email (case-insensitive)
2. Pending approval history entry's approverEmail matches user.email
3. Pending approval history entry's approverName matches any of currentUser.nameMatches
```

### State
- `assignedToMe` — boolean state, default `false`
- Included in `useMemo` dependencies for `directorSubmissions`
- Resets pagination to page 1 when toggled (via existing `useEffect` on `directorSubmissions.length`)

---

## CRITICAL: Never Use Inbox URLs for "View in JotForm" Links

**Rule:** All "View in JotForm" links MUST use `sub.approvalUrl` — the email-style direct URL format:
```
https://eforms.mediaoffice.ae/{internalFormID}?workflowAssignFormTask=1&taskID={taskId}
```

**Never** use the inbox URL format:
```
https://eforms.mediaoffice.ae/inbox/{formId}/{submissionId}
```

- `sub.approvalUrl` is computed in `useSubmissions.ts` from the workflow instance's `accessLink` or constructed from `internalFormID + taskID`
- If `sub.approvalUrl` is not available (workflow not yet fetched), use `'#'` as fallback — do NOT fall back to the inbox URL
- This applies to ALL link locations: REF# column, Title column, Action column (completed/rejected status links), and any future "View in JotForm" links
- The Action column buttons for completed/rejected submissions should use `sub.approvalUrl || '#'`

---

### CORS Note for Deployment
All 14 API files now default to `ALLOWED_ORIGIN = 'https://jot-14march.vercel.app'`.
- Production: works as-is
- Preview deployments (`jot-14march-xyz.vercel.app`): will get CORS errors unless `ALLOWED_ORIGIN` is set in Vercel env vars
- Local dev: set `ALLOWED_ORIGIN=*` in `.env`

### New Workflow Compatibility
Creating a new JotForm workflow is fully compatible. The `/api/jotform` path allowlist covers all discovery paths:
- `user/forms` — form discovery
- `form/{id}/questions` — field detection
- `form/{id}/submissions` — submission fetch
- `submission/{id}` — submission details

Workflow operations (`/api/workflow-action`, `/api/workflow-tasks`, `/api/form-workflow`, `/api/ensure-fields`) use separate endpoints unaffected by Fix 9.

---

## URL Format Rules (per Task Type)

JotForm uses **two different URL formats** in email notifications depending on the task type:

| `element.type` | URL Format | Access Token? |
|---|---|---|
| `workflow_assign_form` | `/{formID}?workflowAssignFormTask=1&taskID={taskID}` | No |
| `workflow_approval` | `/approval-form/{formID}/task/{taskID}/access-token/{token}` | Yes (from accessLink `/share/` URL) |
| `workflow_assign_task` | `/approval-form/{formID}/task/{taskID}/access-token/{token}` | Yes (from accessLink `/share/` URL) |

**Implementation:** Type-aware URL construction is applied in three places:
- `api/email-url.ts` — on-demand URL resolution
- `src/hooks/useSubmissions.ts` — second-pass enrichment (~line 657)
- `api/webhook.ts` — webhook handler (~line 273)

---

## Bulk Submission Cleanup Endpoint

### API: `/api/cleanup-submissions`

**File:** `api/cleanup-submissions.ts`

One-time cleanup endpoint to bulk-delete JotForm submissions. Keeps only submissions where the active workflow task assignee matches a specified email.

### Usage
```
GET /api/cleanup-submissions              → Dry run (default) — lists what would be deleted
GET /api/cleanup-submissions?dryRun=false → Actually deletes submissions from JotForm
```

### How It Works
1. Fetches all forms via `GET /user/forms`
2. Fetches all submissions per form with `addWorkflowStatus=1`
3. For each submission with a `workflowInstanceID`, fetches `GET /workflow/instance/{id}` to find the ACTIVE task's assignee email
4. Submissions where `pendingEmail !== KEEP_EMAIL` → deleted via `DELETE /submission/{id}`
5. Returns summary JSON with kept/deleted counts and details

### Configuration
- `KEEP_EMAIL` constant at top of file (currently `huzaifa.dawasaz@mediaoffice.ae`)
- Change this value to keep different submissions in future cleanups

### History
- **2026-03-23:** Executed cleanup — deleted 73 of 83 submissions, kept 10 (all pending with `huzaifa.dawasaz@mediaoffice.ae`). Zero failures. JotForm DELETE API (`DELETE /submission/{id}`) confirmed working on enterprise instance.
