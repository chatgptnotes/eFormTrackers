# JotFlow — Claude Code Project Guide

## Project Overview
JotFlow is a workflow dashboard that tracks JotForm submissions and their approval workflows. Deployed on Vercel at `jot-14march.vercel.app`. Uses JotForm Enterprise API (`eforms.mediaoffice.ae/API`) + Supabase for persistence + real-time.

## Key Architecture

### Data Flow (How Submissions Load)
```
Page Load / Auto-Refresh (1-5 min)
├── fetchUserForms() → discovers all ENABLED JotForm forms
├── For each form: fetch ALL submissions + questions
├── FIRST PASS: mapGenericSubmission()
│   ├── Reads form FIELD VALUES (dropdown status fields) to determine level/status
│   ├── Dynamic approver detection: scans all submissions to find most recent approver per form+level
│   ├── Merges with manual approver configs from Supabase (jf_approver_config)
│   └── Output: initial Submission[] with best-guess level/status/approver
├── SECOND PASS: Workflow enrichment (up to 50 pending submissions)
│   ├── Calls /api/workflow-tasks?submissionId={id} for each
│   ├── Direct endpoint: GET /workflow/submission/{id}/tasks (single call, falls back to 2-step chain)
│   ├── Returns real tasks with: name, status (COMPLETED/ACTIVE/PENDING), assigneeName, assigneeEmail, level
│   ├── OVERRIDES first pass data: currentLevel, pendingApprover, actionType, approvalHistory, jotformStatus
│   ├── allCompleted → marks as 'completed'
│   └── activeTask → sets real approver name/email, detects step type (approval/task/form)
└── SYNC TO SUPABASE: fire-and-forget POST /api/sync-to-supabase with all enriched records
```

### Critical Files
| File | Role | Risk |
|------|------|------|
| `src/hooks/useSubmissions.ts` | Two-pass enrichment, Supabase sync, auto-refresh | HIGH |
| `api/workflow-tasks.ts` | Fetches real workflow data via direct endpoint (fallback: 2-step chain) | HIGH |
| `api/approval-thread.ts` | Proxies GET /inbox/submission/{id}/thread for real approval comments | LOW |
| `api/webhook.ts` | Handles JotForm webhook POSTs, writes to Supabase | HIGH |
| `api/sync-to-supabase.ts` | Batch upserts enriched records to Supabase | MEDIUM |
| `src/pages/DirectorDashboard.tsx` | PendingWithCell, WorkflowStatusBadge, action buttons | MEDIUM |
| `api/workflow-action.ts` | Approve/reject/complete workflow tasks via JotForm workflow engine | HIGH |
| `api/jotform-update.ts` | Proxies form field updates to JotForm submission API (backup) | LOW |

### Supabase
- URL: `https://eekudqlzzklhyhwkqvme.supabase.co`
- Main table: `jf_submissions` — all submission records synced from JotForm
- History table: `jf_approval_history` — per-level approval actions
- Config table: `jf_approver_config` — manual approver overrides
- Real-time subscriptions on `jf_submissions` and `jf_approval_history` trigger dashboard re-fetch

### JotForm API
- Base: `https://eforms.mediaoffice.ae/API`
- Team ID: `260541093809054`
- Key endpoints used:
  - `GET /user/forms` — discover all forms
  - `GET /form/{id}/submissions` — fetch submissions
  - `GET /workflow/submission/{id}/tasks` — get real workflow tasks (direct, single call)
  - `GET /submission/{id}?addWorkflowStatus=1` — get workflowInstanceID (fallback step 1)
  - `GET /workflow/instance/{id}` — get real workflow taskList (fallback step 2)
  - `GET /inbox/submission/{id}/thread` — real approval thread with comments
  - `POST /submission/{id}` — update form field values
- `POST /workflow/task/{taskId}/complete` — **approve/reject/complete workflow tasks directly**

### Workflow Actions (Approve/Reject from JotFlow)
```
User clicks "Approve & Sign" or "Reject" in JotFlow
├── SubmissionModal captures: comment, signature (drawn), action type
├── POST /api/workflow-action { submissionId, action, comment, signature }
│   ├── Step 1: GET /submission/{id}?addWorkflowStatus=1 → workflowInstanceID
│   ├── Step 2: GET /workflow/instance/{instanceId} → taskList
│   ├── Step 3: Find ACTIVE task → read its outcomes from element.outcomes[]
│   ├── Step 4: Map action to outcomeID:
│   │   ├── "approve" → outcome type APPROVE (outcomeID: 1, green)
│   │   ├── "reject"  → outcome type DENY (outcomeID: 2, red)
│   │   └── "complete" → outcome type CUSTOM (outcomeID: 1, blue)
│   └── Step 5: POST /workflow/task/{taskId}/complete { outcomeID, comment, signature }
│       → JotForm workflow engine advances to next step
├── Optimistic UI update (instant feedback)
├── Form field update as backup (for forms with status dropdowns)
└── Auto-refresh after 3s picks up new workflow state
```

**Key discovery:** `POST /workflow/task/{taskId}/complete` is the undocumented JotForm API
that actually advances workflow tasks. Different task types have different outcomes:
- `workflow_approval` → Approve (1) / Deny (2) — requires `signature` for "Approve & Sign" steps
- `workflow_assign_task` → Complete (1)
- `workflow_assign_form` → Complete (1)

## Important Rules

### DO NOT
- Remove the second pass workflow enrichment — it's the only source of real workflow data
- Remove the fallback 2-step API chain in workflow-tasks.ts — the direct endpoint may not work for all submissions
- Fetch workflow tasks for ALL submissions in parallel without rate limiting (causes API failures)
- Assume form fields reflect real workflow state — many forms have no status fields at all
- Remove the dynamic approver detection from first pass — it provides fallback names for forms with status fields

### ALWAYS
- Keep the 50-submission batch limit on second pass to avoid JotForm rate limits
- Fire-and-forget sync to Supabase after every loadData() — keeps Supabase in sync
- Test with `curl https://jot-14march.vercel.app/api/workflow-tasks?submissionId={id}` to verify workflow data
- Run `npx tsc --noEmit` before pushing — catches type errors

### Known Limitations
- Workflow task fetch limited to 50 pending submissions per load
- 5-minute client-side cache per submission on workflow tasks
- "Approve & Sign" steps require signature data — must pass `signature` field to workflow-action API
- Webhook only fires on new submission creation, not on workflow step changes
- Forms without status dropdown fields rely entirely on second pass for correct status

## Fixes & Improvements (2026-03-17)

### Codebase audit surfaced ~40 issues. 12 high-impact fixes were implemented:

### Bug Fixes
- **Fix 2: Operator precedence in `api/ensure-fields.ts`** — Added parentheses to `(a && b) || (c && d)` pattern at lines 57 and 215. In practice behavior was accidentally correct because `&&` binds tighter, but now intent is explicit.
- **Fix 10: taskId validation in `api/workflow-action.ts`** — Added guard `if (!taskId)` before using in URL construction. Prevents runtime crash if active task has no ID.

### Security Hardening
- **Fix 8: CORS default changed from `'*'` to `'https://jot-14march.vercel.app'`** — All 14 `api/*.ts` files now use `process.env.ALLOWED_ORIGIN || 'https://jot-14march.vercel.app'`. For local dev, set `ALLOWED_ORIGIN=*` in env. For preview deployments, set the correct origin in Vercel env vars.
- **Fix 9: Path validation on `/api/jotform` proxy** — Allowlist regex restricts `path` param to: `user/forms`, `form/{id}/submissions|questions|properties`, `submission/{id}`. Prevents arbitrary JotForm API path traversal. All frontend calls use paths within this allowlist.

### UX Improvements
- **Fix 1: Error banner in `DirectorDashboard.tsx`** — Shows amber warning banner when `data.error` is set (e.g. "Some submissions could not be loaded").
- **Fix 7: 30s timeout on workflow-action fetch in `useApprovalAction.ts`** — Previously could hang indefinitely. Now aborts with user-friendly "timed out" message.
- **Fix 3: Clear all `jotflow_*` caches on sign-out in `AuthContext.tsx`** — Previously only cleared `jotflow_filters`. Now loops `Object.keys(localStorage)` and removes all `jotflow_*` keys. First load after re-login is slightly slower (fresh fetch).

### Dead Code Removal
- **Fix 4: Deleted `src/pages/Dashboard.tsx`** — Had hardcoded field IDs (`submission[8]`), hardcoded director name, never routed in `App.tsx`.
- **Fix 5: Removed `needsSync`** — Was hardcoded to `false` in `submissionMapper.ts`. Removed from: `Submission` type (`src/types/index.ts`), `submissionMapper.ts` (assignment), `DirectorDashboard.tsx` (`syncNeededCount` computation and stat card label).
- **Fix 6: Removed `hasCachedData`** — Was hardcoded to `false` in `useSubmissions.ts`. Removed variable, simplified always-true `else if` branches.
- **Fix 11: `FORM_ONLY_IDS`** — Already removed in prior cleanup. No action needed.
- **Fix 12: Removed `mapSupabaseRow`** — Exported function in `submissionMapper.ts` never imported anywhere (Supabase Phase 1 removed).

### API Routing (What Goes Where)
| Frontend Action | API Endpoint | Goes through `/api/jotform`? |
|----------------|-------------|------------------------------|
| Discover forms | `/api/jotform?path=user/forms` | YES — allowlisted |
| Fetch questions | `/api/jotform?path=form/{id}/questions` | YES — allowlisted |
| Fetch submissions | `/api/jotform?path=form/{id}/submissions` | YES — allowlisted |
| Submission details | `/api/jotform?path=submission/{id}` | YES — allowlisted |
| Workflow tasks (enrichment) | `/api/workflow-tasks` | NO — separate endpoint |
| Approval thread | `/api/approval-thread` | NO — separate endpoint |
| Approve/Reject | `/api/workflow-action` | NO — separate endpoint |
| Upload signature | `/api/upload-signature` | NO — separate endpoint |
| Field update (backup) | `/api/jotform-update` | NO — separate endpoint |
| Ensure fields | `/api/ensure-fields` | NO — separate endpoint |
| Detect approvers | `/api/detect-approvers` | NO — separate endpoint |
| Form workflow config | `/api/form-workflow` | NO — separate endpoint |

### New Workflow Compatibility
Creating a new JotForm workflow works without issues. All discovery (`user/forms`), questions (`form/{id}/questions`), submissions (`form/{id}/submissions`) paths are allowlisted. Workflow operations use dedicated endpoints not affected by the path validation.
