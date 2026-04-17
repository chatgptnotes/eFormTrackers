# JotFlow — Claude Code Instructions

## Project Overview
JotFlow is a workflow management dashboard built with React + TypeScript + Vite, deployed on Vercel. It integrates with JotForm's workflow engine API to manage multi-level approval workflows.

## Tech Stack
- **Frontend:** React 18, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Vercel serverless functions (`/api`)
- **Database:** Supabase (PostgreSQL)
- **Forms/Workflows:** JotForm API + Workflow Engine API
- **Auth:** Supabase Auth

## Key Files
- `src/pages/DirectorDashboard.tsx` — Main dashboard with submissions table, filters, actions
- `src/hooks/useSubmissions.ts` — Data fetching, two-pass workflow enrichment, Supabase sync
- `src/types/index.ts` — TypeScript types for submissions, approval history
- `api/workflow-action.ts` — Approve/reject/complete workflow tasks
- `api/workflow-tasks.ts` — Fetch workflow instance data from JotForm
- `skill.md` — Detailed documentation of Pending With column logic, workflow actions, and feature details

## Build & Dev
- `npm run dev` — Start dev server
- `npm run build` — TypeScript check + Vite build
- Working directory for the app: `jotformTest14march/`

## Features
- **Director Dashboard:** Shows all submissions with approval status, pending approver, aging, workflow status, and action buttons
- **Assigned to Me:** Toggle filter on dashboard header — filters table to show only submissions assigned to the logged-in user
- **Review & Approve / Reject:** Inline workflow actions with signature support
- **Comment:** Inline comment panel per submission
- **View Task / Complete Form:** Links to JotForm task/form pages
- **Auto Refresh:** Configurable live refresh (1m/5m/10m)
- **Pagination:** 10 rows per page
- **Supabase Sync:** All enriched submissions synced to Supabase on each load

## Important Notes
- Always run `npm run build` after changes to verify TypeScript + build
- The second pass (workflow instance API) is the authoritative data source — see `skill.md` for full details
- CORS: production defaults to `https://jot-14march.vercel.app`, set `ALLOWED_ORIGIN=*` for local dev

## Karpathy Coding Guidelines

> Source: https://github.com/forrestchang/andrej-karpathy-skills
> Derived from Andrej Karpathy's observations on LLM coding pitfalls.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- Do not improve adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style, even if you would do it differently.
- Only remove imports/variables/functions that YOUR changes made unused.
- Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals before starting.
- For multi-step tasks, state a brief plan with a verify step for each.
- Define success criteria concretely — weak criteria require constant clarification.

