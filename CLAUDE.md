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
