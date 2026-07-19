# JotFlow

## Purpose

JotFlow is an internal approval dashboard for JotForm Enterprise workflows. It
shows each user only the workflow items awaiting their action and lets them
approve, reject, complete a task, or fill an assigned form.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind, Socket.IO client
- Backend: Express, Socket.IO, Zod, Pino
- Data: PostgreSQL
- Workflow provider: JotForm Enterprise
- Deployment: Windows IIS with the Express backend; frontend can also deploy
  to Vercel

## Current workflow data flow

```text
JotForm workflow + Prefills API
        -> Express poller/webhook
        -> PostgreSQL
        -> Socket.IO update
        -> React dashboard
```

The backend is the only layer that calls JotForm. The browser reads the stored
workflow state and refreshes when the backend emits `submissions:updated`.

## Assigned-form safety

`workflow_assign_form` tasks have two supported cases:

1. **Prefill configured**: JotForm creates a per-submission `/prefill/{id}`
   link asynchronously. The dashboard shows **Fetching pre-filled form…** and
   disables opening the card until that ID is available. This prevents opening
   an unlinked second form.
2. **No prefill configured**: the Prefills API returns no template for the
   assigned form. The dashboard shows the normal assigned-form action because
   no prefill URL is expected.

The Prefills API result is cached for five seconds. The enabled quick poller
runs every second (`POLL_QUICK_SECONDS=1` in `backend/.env`) and broadcasts
newly-ready links to connected dashboards.

## Key files

- `backend/lib/prefill.js` — detects prefill configuration, resolves and marks
  `ready`, `pending`, or `not_required` form tasks
- `backend/lib/jotform-link.js` — builds safe JotForm task and form URLs
- `backend/lib/poller.js` — syncs JotForm workflow state and emits updates
- `backend/routes/forms-workflow.js` — resolves authenticated JotForm action
  URLs
- `frontend/src/pages/ModernDashboard.tsx` — action cards and prefill loader
- `frontend/src/lib/jotformLinks.ts` — frontend validation of usable links
- `frontend/src/hooks/useSubmissions.ts` — database reads and Socket.IO refresh

## Verification

```sh
cd backend && node tests/prefill.test.js && node tests/jotform-link.test.js
cd .. && npm run build
```

Restart the backend after changing `backend/.env` or backend code.
