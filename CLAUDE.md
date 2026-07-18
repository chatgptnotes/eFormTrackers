# JotFlow — Claude Code Instructions

## Project Overview
JotFlow is a workflow approval dashboard that wraps a configured JotForm Enterprise workflow engine (`JOTFORM_HOST`). The frontend is React + TypeScript + Vite; the backend is an Express server with self-hosted PostgreSQL. Primary deploy target is **Windows IIS** (with a Vercel option for the frontend only).

> Historical note: the project originally ran as Vercel serverless functions + Supabase. As of 2026-05-23 it was migrated to Express + Postgres + IIS (see `CHANGES-2026-05-23.md`). Older Supabase wording in `skill.md` refers to logic, not the live stack.

## Tech Stack
- **Frontend:** React 18, TypeScript, Vite 5, Tailwind CSS, Framer Motion, Socket.IO client
- **Backend:** Express 4 (`backend/`), Socket.IO, Helmet, express-rate-limit, Pino, Zod
- **Database:** Self-hosted PostgreSQL (driver `pg`); sessions via `connect-pg-simple`
- **Auth:** Local bcrypt + Microsoft / Azure AD SSO (`@azure/msal-node`); workspace gate against JotForm Enterprise team membership
- **Forms / Workflows:** JotForm Enterprise API + Workflow Engine API (GDMO key)
- **Deploy:** Windows IIS via iisnode (root `server.js`, `web.config` reverse-proxy to `localhost:3001`); Vercel `vercel.json` builds the frontend only

## Key Files
- `backend/server.js` — process entry; starts HTTP + Socket.IO; SIGTERM handler
- `backend/app.js` — Express app factory (middleware, routes, `/api/health`, `/api/health/ready`)
- `backend/lib/jotform.js` — JotForm fetch (keyType-aware, AbortController timeout, header `APIKEY`)
- `backend/lib/key-type.js` — `readKeyType(req)`; defaults to `'gdmo'` (the only configured key)
- `backend/lib/workflow-task.js` — `extractTask` + `deriveWorkflowStatus` (authoritative status from instance + tasks)
- `backend/lib/visibility.js` — `isRowVisible` / `filterVisibleRows` / `isAdminRole` — single source of truth for per-row access
- `backend/lib/poller.js` — background poller (gated by `ENABLE_POLLER=1`; jf_forms table must exist)
- `backend/routes/submissions-actions.js` — `/api/workflow-action` approve/reject/complete
- `backend/routes/submissions-jotform.js` — `/api/webhook` (JotForm push)
- `backend/routes/admin-sync.js` — `/api/admin/sync-all[-stream]` (bulk re-sync)
- `backend/scripts/resync-workflow-status.js` — DB-only reconcile from stored task lists
- `frontend/src/hooks/useSubmissions.ts` — DB-first data hook + Socket.IO + caches
- `frontend/src/hooks/submissionMappers.ts` — task-authoritative `mapSupabaseRow`
- `frontend/src/config/currentUser.ts` — `isSubmissionVisible`, `isAwaitingMyAction`, `getMyActionType`, `getMyWorkflowRole`
- `frontend/src/pages/ModernDashboard.tsx` — primary dashboard (personal action queue)
- `frontend/src/components/{SubmissionModal,WorkflowDetailsSidebar}.tsx` — approve & sign flow

## Build & Dev
- Frontend: `cd frontend && npm install && npm run dev` (Vite on `:5173`)
- Backend: `cd backend && npm install && node server.js` (Express on `:3000` in dev / `:3001` under IIS) — plain node, no auto-reload; restart on backend edits
- Full build: `npm run build` (root, runs frontend + backend)
- Re-sync stale rows from stored task lists: `cd backend && node scripts/resync-workflow-status.js`
- Health: `curl http://localhost:3000/api/health` (shallow) / `?deep=1` or `/api/health/ready` (probes Postgres)

## Features
- **Modern Dashboard:** Personal action queue — shows only items awaiting the logged-in user (current pending approver or ACTIVE task assignee, including parallel-approval steps). Same rule for every user; no admin bypass on this page.
- **Completed:** Workflows the user participated in that are completed/rejected. Detection is task-authoritative (workflow-engine instance status + tasks beat stale form-status columns).
- **Pending With:** Workflows the user is involved in that are still in flight (pending with them or with someone else).
- **CTA matches active task type:** card button is "Review & Approve" / "Fill Form" / "Open Task" based on the user's active workflow task (`workflow_approval` / `workflow_assign_form` / `workflow_assign_task`).
- **Review & Approve / Reject:** Signature-required approve flow (`SubmissionModal`) backed by `POST /api/workflow-action` → `POST /workflow/task/{taskId}/complete`. Approve outcome resolves to the JotForm `APPROVE` / `DENY` outcome ID. Modal auto-closes on success.
- **Auto Refresh:** Live Socket.IO updates + configurable refresh interval.
- **Sync:** Settings → "Sync All" triggers `/api/admin/sync-all-stream` (SSE). Backend now derives status from the workflow engine (instance status + task list), not form status dropdowns.

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

<!-- IRONBARK:START - Auto-generated, do not edit -->
## Ironbark

This project uses the Ironbark learning loop with auto-sync to the community skill repo (`chatgptnotes/ironbark`).

- **Auto-harvest**: After 15+ tool calls, Ironbark nudges you to run `/ironbark`
- **Manual harvest**: Run `/ironbark` at any time to extract reusable patterns
- **Background sync**: Every 30 min, `sync-cli.js` pulls new community skills and pushes local ones
- **Opt-out**: `IRONBARK_SYNC_DISABLED=1`

### Available Harvested Skills (135)

Loaded from `~/.claude/skills/harvested/`. Reference any skill below by name or path when the task matches.

| Skill | Description | Path |
|-------|-------------|------|
| `active-inactive-toggle-with-counter` | Soft-hide records with an is_active boolean column — pill button on each card toggles active/hidden, inactive cards dim with grayscale, a "S | `/Users/murali/.claude/skills/harvested/active-inactive-toggle-with-counter/SKILL.md` |
| `Adamrit Final Bill Lock — pre-deploy SHA256 check` | Freezes src/pages/FinalBill.tsx in the Adamrit hospital-management app. A `prebuild` script (chained ahead of `vite build`, which Vercel inv | `/Users/murali/.claude/skills/harvested/adamrit-check-test/SKILL.md` |
| `Annotated Sales-Pitch Coaching PDF` | When you write a 30/60/90-second elevator pitch for someone (founder rehearsing for an enterprise meeting, BNI member doing a 60-second intr | `/Users/murali/.claude/skills/harvested/annotated-pitch-coaching-pdf/SKILL.md` |
| `architecture-flowchart-on-every-project-plan` |  | `/Users/murali/.claude/skills/harvested/architecture-flowchart-on-every-project-plan/SKILL.md` |
| `Async AI Advisory on Real-Time Hot Path` | Pattern for void-launching AI analysis from time-critical control loops (alarm engines, tag processors) with dedup guards, cooldown periods, | `/Users/murali/.claude/skills/harvested/async-ai-advisory-hot-path/SKILL.md` |
| `Auto-Tenant Fetch Wrapper` | Modify the frontend API fetch wrapper to auto-append tenant_id from session storage so all existing API calls get tenant scoping without per | `/Users/murali/.claude/skills/harvested/auto-tenant-fetch-wrapper/SKILL.md` |
| `BNI CRM — Bugs & Gotchas Harvested During Build` | Non-obvious issues encountered while building a Supabase-backed multi-page CRM (BNI 121). Covers nginx root-path confusion, PostgREST schema | `/Users/murali/.claude/skills/harvested/bni-crm-build-pitfalls/SKILL.md` |
| `Browser-Console curl|bash Deploy Bootstrap` | When SSH to a VPS is blocked from the agent's network and the only available shell is a browser-based console (Hostinger hPanel, DigitalOcea | `/Users/murali/.claude/skills/harvested/browser-console-curl-bash-deploy/SKILL.md` |
| `bulk-file-to-db-importer` | Node.js script to bulk-import local files (HTML, PDF, etc.) into a Supabase table under a specific user, with a permanent exclusion list and | `/Users/murali/.claude/skills/harvested/bulk-file-to-db-importer/SKILL.md` |
| `Chatbot Reply/Ignore Intent Gate` | System prompt pattern that adds a first-pass REPLY vs IGNORE decision layer to any chatbot, preventing it from replying to casual acknowledg | `/Users/murali/.claude/skills/harvested/chatbot-reply-intent-gate/SKILL.md` |
| `Claude CLI: ANTHROPIC_API_KEY env silently overrides Max-plan OAuth` | When the Claude CLI runs inside a container or service and ANTHROPIC_API_KEY is in the environment, it ignores the OAuth credentials in ~/.c | `/Users/murali/.claude/skills/harvested/claude-cli-oauth-vs-apikey-precedence/SKILL.md` |
| `Claude Code -> DeepSeek Backend (Anthropic-Compatible Redirect)` | Point Claude Code at DeepSeek's Anthropic-compatible endpoint via ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN + ANTHROPIC_MODEL env vars. Cove | `/Users/murali/.claude/skills/harvested/claude-code-deepseek-backend/SKILL.md` |
| `Claude Code Permanent SSH Access to VPS` | Set up passwordless SSH key access so Claude Code can run remote commands on a VPS directly via Bash tool, without prompting for a password  | `/Users/murali/.claude/skills/harvested/claude-vps-ssh-access/SKILL.md` |
| `client-facing-no-platform-reuse-framing` |  | `/Users/murali/.claude/skills/harvested/client-facing-no-platform-reuse-framing/SKILL.md` |
| `client-project-plan-bettroi-style-pipeline` |  | `/Users/murali/.claude/skills/harvested/client-project-plan-bettroi-style-pipeline/SKILL.md` |
| `cloud-to-vps-http-bridge` | Lightweight Node.js HTTP bridge that lets a serverless cloud platform (Vercel, Railway, etc.) trigger actions on a self-hosted VPS service — | `/Users/murali/.claude/skills/harvested/cloud-to-vps-http-bridge/SKILL.md` |
| `copy-sql-migration-to-clipboard` | After writing any SQL migration file, immediately copy it to clipboard with pbcopy so the user can paste directly into their DB console (Sup | `/Users/murali/.claude/skills/harvested/copy-sql-migration-to-clipboard/SKILL.md` |
| `Credential Survivorship Audit` | When a credentials-based failure recurs after a previous fix, the credential was only partially removed. Grep all config locations first, fi | `/Users/murali/.claude/skills/harvested/credential-survivorship-audit/SKILL.md` |
| `Cron-Poll Continuous Deploy via git ls-remote SHA Check` | When GitHub Actions SSH-deploy and inbound webhooks are both unavailable (SSH port blocked from runners, VPS behind NAT/firewall, no webhook | `/Users/murali/.claude/skills/harvested/cron-poll-continuous-deploy/SKILL.md` |
| `cross-brand-proposal-style-sender-mismatch` |  | `/Users/murali/.claude/skills/harvested/cross-brand-proposal-style-sender-mismatch/SKILL.md` |
| `cross-group-drag-and-drop-categorize` | Drag items between categorized groups with react-beautiful-dnd. Each group is its own Droppable keyed by category name; onDragEnd updates th | `/Users/murali/.claude/skills/harvested/cross-group-drag-and-drop-categorize/SKILL.md` |
| `Custom Slash Command — Encode Multi-Step Protocols` | Create custom Claude Code slash commands in ~/.claude/commands/ that invoke repeatable multi-step workflows with $ARGUMENTS substitution — s | `/Users/murali/.claude/skills/harvested/custom-slash-command-protocol/SKILL.md` |
| `custom-domain-wrong-project-404` | A custom domain returns 404 (or serves stale features) on routes that demonstrably exist in your current codebase, because the domain is att | `/Users/murali/.claude/skills/harvested/custom-domain-wrong-project-404/SKILL.md` |
| `deep-link-copy-button-hash-anchor` | Lightweight one-click "copy link" button that copies a deep URL to clipboard, scrolling to a specific record via `#record-{id}` hash anchor  | `/Users/murali/.claude/skills/harvested/deep-link-copy-button-hash-anchor/SKILL.md` |
| `document-type-discipline-plan-vs-proposal` |  | `/Users/murali/.claude/skills/harvested/document-type-discipline-plan-vs-proposal/SKILL.md` |
| `document-version-history` | Save every version of a document before overwriting — Supabase versions table, PATCH intercept, restore endpoint, and UI history panel | `/Users/murali/.claude/skills/harvested/document-version-history/SKILL.md` |
| `Dual LLM Provider Budget Defense` | Production budget-burn protection when running two LLM providers — per-user app-layer daily cap (not nginx per-IP), burst detection, provide | `/Users/murali/.claude/skills/harvested/dual-llm-provider-budget-defense/SKILL.md` |
| `Dual-Publish Reusable Setup Guide as Local Skill + Standalone Public Repo` | When the user asks to save procedural how-to content "for next time," publish it in two places at once - as a harvested SKILL.md (auto-loads | `/Users/murali/.claude/skills/harvested/dual-publish-skill-and-repo/SKILL.md` |
| `Email-Allowlist Dual-Gate Dashboard` | Restrict access to a privileged dashboard (CEO/CFO/Director/Admin view) to a hard-coded allowlist of email addresses. Defense in depth at th | `/Users/murali/.claude/skills/harvested/email-allowlist-dual-gate-dashboard/SKILL.md` |
| `env-var-secret-newline-and-redeploy-snapshot` | Two silent traps when setting platform secrets from the CLI — `echo` appends a trailing newline that breaks exact-match secrets (passwords,  | `/Users/murali/.claude/skills/harvested/env-var-secret-newline-and-redeploy-snapshot/SKILL.md` |
| `EventEmitter → Socket.IO → Zustand Reactive Pipeline` | Full backend-to-frontend reactive chain using Node EventEmitter as source, Socket.IO rooms for transport, and Zustand store for state — with | `/Users/murali/.claude/skills/harvested/eventemitter-socketio-zustand-pipeline/SKILL.md` |
| `excel-matrix-to-react-lookup` | Convert a multi-dimensional Excel combination matrix into a JS lookup table and React UI card, dynamically driven by algorithm/API output sc | `/Users/murali/.claude/skills/harvested/excel-matrix-to-react-lookup/SKILL.md` |
| `Exhaustive Error Hunting — Never Stop at the First Fix` | When debugging a broken feature, NEVER assume the first error found is the only one. Systematically trace the entire data path and fix ALL b | `/Users/murali/.claude/skills/harvested/exhaustive-error-hunting/SKILL.md` |
| `Express Rate Limit Hardening` | Security fixes for express-rate-limit — never trust X-Forwarded-For in keyGenerator, handle IPv6, use validate options | `/Users/murali/.claude/skills/harvested/express-rate-limit-hardening/SKILL.md` |
| `Express Tenant Middleware Chain` | requireAuth → requireTenantAccess → route pattern with profile caching and role-based tenant resolution for multi-tenant Express apps | `/Users/murali/.claude/skills/harvested/express-tenant-middleware-chain/SKILL.md` |
| `file-list-image-preview-modal` | In a file list, swap the generic icon for an image thumbnail when file_type starts with "image/", and add an Eye button that opens a MIME-aw | `/Users/murali/.claude/skills/harvested/file-list-image-preview-modal/SKILL.md` |
| `front-back-id-document-image-upload` | Upload front and back images for any identity document (PAN, Aadhaar, credit card, passport, etc.) — two upload buttons, stored as separate  | `/Users/murali/.claude/skills/harvested/front-back-id-document-image-upload/SKILL.md` |
| `gh api Bulk Operations Without Zsh Glob Expansion Bugs` | When scripting `gh api` to POST/PATCH the same payload to many GitHub repos (bulk webhooks, branch-protection rules, repo settings), the `-f | `/Users/murali/.claude/skills/harvested/gh-api-bulk-json-stdin/SKILL.md` |
| `Global CLAUDE.md — Auto-Loaded Coding Standards` | Create ~/.claude/CLAUDE.md to inject coding rules, forbidden patterns, and workflow protocols into every Claude Code session automatically — | `/Users/murali/.claude/skills/harvested/global-claude-md-standards/SKILL.md` |
| `Google OAuth COOP Popup Fix on Vercel` | Two-stage fix for Google OAuth popup blocked by Cross-Origin-Opener-Policy (COOP) on Vercel — first add permissive headers, then switch to c | `/Users/murali/.claude/skills/harvested/google-oauth-coop-vercel-fix/SKILL.md` |
| `Hand-Fillable PDF Blanks via Dotted-Underline CSS Spans` | When generating a PDF that will be printed and signed by hand (legal forms, KYC, lease agreements, school admission, customs declarations, v | `/Users/murali/.claude/skills/harvested/dotted-blank-fillable-pdf/SKILL.md` |
| `handwriting-ocr-via-claude-sonnet-slack-pipeline` | Capture handwritten paper notes into your knowledge base by photographing a page → dropping in Slack → bot OCRs via Claude Sonnet (preserves | `/Users/murali/.claude/skills/harvested/handwriting-ocr-via-claude-sonnet-slack-pipeline/SKILL.md` |
| `HTML Print Window with Per-Section Page Breaks` | Generate downloadable PDFs from a SPA by opening a styled HTML document in a new window, applying CSS `@media print` rules with `page-break- | `/Users/murali/.claude/skills/harvested/html-print-window-section-pagebreaks/SKILL.md` |
| `HTML-to-PPTX Programmatic Generation` | Generate professional PowerPoint presentations (.pptx) programmatically using python-pptx — build slides with shapes, colored cards, code bl | `/Users/murali/.claude/skills/harvested/html-to-pptx-python/SKILL.md` |
| `HTTP API Failure Isolation via Probe Matrix` | When an HTTP API call fails with an ambiguous error and you don't know whether the cause is the URL, the auth header, the request body, the  | `/Users/murali/.claude/skills/harvested/http-api-probe-matrix-isolation/SKILL.md` |
| `human-in-loop-classification-via-markdown-review` | When an AI classifier auto-files records (meetings, emails, photos, etc.) into folders but quality matters, generate a single MARKDOWN REVIE | `/Users/murali/.claude/skills/harvested/human-in-loop-classification-via-markdown-review/SKILL.md` |
| `Idempotent ~/.zshrc / ~/.bashrc Block Append with Marker-Based Dedupe` | Append a multi-line block of exports/aliases/path edits to a user's shell rc file via an installer that is safe to re-run. Uses a marker com | `/Users/murali/.claude/skills/harvested/idempotent-shellrc-marker-dedupe/SKILL.md` |
| `idempotent-rag-ingestion-via-source-ref-delete` | Prevent duplicate vector chunks when re-syncing markdown / docs into a RAG store. Before inserting chunks for a file, DELETE all existing ch | `/Users/murali/.claude/skills/harvested/idempotent-rag-ingestion-via-source-ref-delete/SKILL.md` |
| `Industrial Rollback Policy Pattern` | PLC batch write rollback with persistence, exponential retry, timeout, and real-time operator notifications via Socket.IO | `/Users/murali/.claude/skills/harvested/rollback-policy-pattern/SKILL.md` |
| `karpathy-guidelines` | Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make | `/Users/murali/.claude/skills/harvested/karpathy-guidelines/SKILL.md` |
| `LLM Chat Context — History Depth and Temperature Config` | Configure conversation history depth (maxHistoryMessages) and temperature on a deployed LLM chatbot to prevent context amnesia and hallucina | `/Users/murali/.claude/skills/harvested/llm-chat-context-config/SKILL.md` |
| `LLM Model Routing` | Regex-based classifier to route simple user queries to cheap models (Haiku) and complex ones to expensive models (Sonnet), with conservative | `/Users/murali/.claude/skills/harvested/llm-model-routing/SKILL.md` |
| `LLM Provider baseUrl + API-Type URL Construction Bug` | When a custom LLM provider's baseUrl already includes a version suffix and the gateway appends /v1/messages, you get /{version}/v1/messages  | `/Users/murali/.claude/skills/harvested/llm-provider-url-construction-bug/SKILL.md` |
| `LLM Vision Confidence Escalation Cascade` | Two-stage vision pipeline — cheap primary model on every request, expensive model only on low-confidence results. Cuts cost ~80% vs single-m | `/Users/murali/.claude/skills/harvested/llm-vision-confidence-escalation-cascade/SKILL.md` |
| `Mac Disk Space Cleanup Playbook` | Systematic Mac disk space recovery — ordered by impact. Covers Chrome AI models, screen recordings, node_modules, Zoom recordings, app cache | `/Users/murali/.claude/skills/harvested/mac-disk-space-cleanup-playbook/SKILL.md` |
| `macOS Chrome Disk-Write Quota Crash Fix` | Diagnose and fix Chrome being killed by macOS for exceeding disk write limits — root cause is the 4 GB OptGuideOnDeviceModel AI model rewrit | `/Users/murali/.claude/skills/harvested/macos-chrome-disk-write-crash-fix/SKILL.md` |
| `MCA Director-Appointment Form Generator (DIR-2 / DIR-8 / MBP-1 / Info Template)` | A repeatable HTML→PDF generator for filling India's Ministry of Corporate Affairs director-appointment forms. The user keeps verified KYC va | `/Users/murali/.claude/skills/harvested/mca-director-form-generator/SKILL.md` |
| `multi-agent-code-review-fanout` | Parallel code review by fanning out one Agent per file/feature surface. Each agent gets a focused per-file prompt with specific concerns and | `/Users/murali/.claude/skills/harvested/multi-agent-code-review-fanout/SKILL.md` |
| `Multi-Channel Alert Gateway` | BaseChannel abstraction + severity-based routing + parallel delivery via Promise.allSettled + retry + delivery tracking table | `/Users/murali/.claude/skills/harvested/multi-channel-alert-gateway/SKILL.md` |
| `Multi-Tenant Audit Checklist` | Systematic methodology for finding multi-tenant data leaks — check every GET endpoint, AI context, external clients, and trace ownership cha | `/Users/murali/.claude/skills/harvested/multi-tenant-audit-checklist/SKILL.md` |
| `No Mock Data in Production SCADA/Multi-Modal Apps` | Eliminate hardcoded mock arrays in CRUD pages and backend demo-data fallbacks — every feature must use real API calls with database persiste | `/Users/murali/.claude/skills/harvested/no-mock-data-in-production/SKILL.md` |
| `No Unwired Placeholders — Wire Everything on First Pass` | Every button, link, and interactive element must have a working onClick/navigation handler from the moment it's created. Never leave placeho | `/Users/murali/.claude/skills/harvested/no-unwired-placeholders/SKILL.md` |
| `no-em-dashes-in-pdf` | Remove em dashes and en dashes from HTML before Chrome headless PDF generation — they render inconsistently and look unprofessional in print | `/Users/murali/.claude/skills/harvested/no-em-dashes-in-pdf/SKILL.md` |
| `oauth-headless-ssh-tunnel` | Complete an OAuth2 browser flow on a headless Linux server by forwarding the redirect URI port via SSH tunnel — no browser, VNC, or public p | `/Users/murali/.claude/skills/harvested/oauth-headless-ssh-tunnel/SKILL.md` |
| `OpenClaw WhatsApp Echo Loop & LLM Quota Fix` | Stop infinite WhatsApp message loops caused by selfChatMode and quota-exceeded LLM keys in OpenClaw. Also covers zai/custom provider 404 bug | `/Users/murali/.claude/skills/harvested/openclaw-whatsapp-loop-fix/SKILL.md` |
| `openwrt-busybox-shell-scripting` | Practical shell scripting on OpenWrt/BusyBox edge devices (Teltonika TRB/RUT, GL.iNet, etc.). Covers what doesn't work (bash, jq, arrays) an | `/Users/murali/.claude/skills/harvested/openwrt-busybox-shell-scripting/SKILL.md` |
| `pdf-spec-to-compliance-matrix` | Methodological pattern for turning a vendor specification PDF into a citation-anchored markdown compliance matrix. Extract PDF text with pdf | `/Users/murali/.claude/skills/harvested/pdf-spec-to-compliance-matrix/SKILL.md` |
| `Pentest-Driven Architecture Review` | Validate architectural decisions against the most recent pentest report + a handful of targeted live probes — faster and more precise than r | `/Users/murali/.claude/skills/harvested/pentest-driven-architecture-review/SKILL.md` |
| `per-record-file-attachment` | Attach a single file (image or PDF) to an individual DB record — store the path in a nullable column on the record, upload with upsert so Re | `/Users/murali/.claude/skills/harvested/per-record-file-attachment/SKILL.md` |
| `permanent-rule-three-authority-propagation` |  | `/Users/murali/.claude/skills/harvested/permanent-rule-three-authority-propagation/SKILL.md` |
| `pgvector Multi-Tenant Retrieval` | Multi-tenant pgvector RAG pattern — enforce project/tenant isolation at the query layer with WHERE project_id = ANY($ids), never trust RLS w | `/Users/murali/.claude/skills/harvested/pgvector-multitenant-retrieval/SKILL.md` |
| `Placeholder Audit and Resolution Pattern` | Systematic scan for empty placeholders, disabled buttons, stub endpoints, dead files, and unmounted routes — then resolve each by either imp | `/Users/murali/.claude/skills/harvested/placeholder-audit-pattern/SKILL.md` |
| `plain-english-explainer-box` | Add a "How to read this document" plain-language box to any technical document so non-technical stakeholders understand purpose and structur | `/Users/murali/.claude/skills/harvested/plain-english-explainer-box/SKILL.md` |
| `plain-english-stakeholder-glossary-companion` |  | `/Users/murali/.claude/skills/harvested/plain-english-stakeholder-glossary-companion/SKILL.md` |
| `Plan File Versioned Evolution` | How to evolve a committed roadmap document incrementally via targeted Edit calls, version-bump footers, and commit messages that explain WHY | `/Users/murali/.claude/skills/harvested/plan-file-versioned-evolution/SKILL.md` |
| `PLC Live Integration Test Infrastructure` | Software PLC simulators + test harness for validating SCADA protocol adapters with real TCP traffic instead of mocks | `/Users/murali/.claude/skills/harvested/plc-live-test-infrastructure/SKILL.md` |
| `PM2 Cluster Mode Breaks In-Memory SCADA State` | PM2 cluster mode causes polling engine, tag engine, and Socket.IO room subscriptions to split across workers — use single instance for SCADA | `/Users/murali/.claude/skills/harvested/pm2-cluster-scada-pitfall/SKILL.md` |
| `Postgres FK Constraint Repair via Dynamic DO Block` | When a foreign-key constraint was added out-of-band (via the database dashboard, ad-hoc psql session, or an old script) and you don't know w | `/Users/murali/.claude/skills/harvested/postgres-fk-repair-dynamic-block/SKILL.md` |
| `PostgREST Schema Cache Reload After DDL` | Supabase / PostgREST returns "Could not find the 'X' column of 'Y' in the schema cache" even after `alter table add column` succeeds, becaus | `/Users/murali/.claude/skills/harvested/postgrest-schema-cache-reload/SKILL.md` |
| `pre-save-file-upload-temp-uuid` | Upload files in an "Add" form before the DB record exists — generate a crypto.randomUUID() on component mount as the temp record ID, upload  | `/Users/murali/.claude/skills/harvested/pre-save-file-upload-temp-uuid/SKILL.md` |
| `printable-standalone-react-page` | React page that renders clean for printing/PDF — sidebar excluded via route prefix, @media print hides controls, window.print() triggers bro | `/Users/murali/.claude/skills/harvested/printable-standalone-react-page/SKILL.md` |
| `Prisma SQL Injection Defense` | Safe patterns for dynamic SQL with Prisma $queryRawUnsafe — allowlist maps instead of string interpolation for identifiers | `/Users/murali/.claude/skills/harvested/prisma-sql-injection-defense/SKILL.md` |
| `Process Log Tracing — Find Logs When Not Under Named Systemd Service` | When a process logs to systemd journal but isn't registered as a named service, journalctl -u <name> returns nothing. Trace via fd/1 socket  | `/Users/murali/.claude/skills/harvested/process-log-tracing/SKILL.md` |
| `Project Gate Pattern` | Enforce project selection before accessing project-scoped pages — gate at layout level, not per-page | `/Users/murali/.claude/skills/harvested/project-gate-pattern/SKILL.md` |
| `proposal-field-standardization` |  | `/Users/murali/.claude/skills/harvested/proposal-field-standardization/SKILL.md` |
| `pull-based-remote-agent-architecture` | Remote shell execution on NAT-bound IoT/edge devices via cloud-polling agent. Device pulls commands from HTTPS API instead of accepting inbo | `/Users/murali/.claude/skills/harvested/pull-based-remote-agent-architecture/SKILL.md` |
| `python-fstring-html-curly-brace-trap` |  | `/Users/murali/.claude/skills/harvested/python-fstring-html-curly-brace-trap/SKILL.md` |
| `quick-login-direct-auth` | Quick-login buttons that directly authenticate via Supabase auth API on click — not just pre-filling form fields. Fixes the pattern where cl | `/Users/murali/.claude/skills/harvested/quick-login-direct-auth/SKILL.md` |
| `railway-cli-noninteractive-auth` | Railway CLI's OAuth login token doesn't persist to non-interactive subshells (Claude Code, CI scripts, cron). The ~/.railway/config.json tok | `/Users/murali/.claude/skills/harvested/railway-cli-noninteractive-auth/SKILL.md` |
| `railway-native-dep-removal` | When migrating from a native C++ npm package (better-sqlite3, bcrypt, sharp, canvas) to a pure-JS alternative (Prisma, argon2, etc.), remove | `/Users/murali/.claude/skills/harvested/railway-native-dep-removal/SKILL.md` |
| `railway-toml-ui-precedence` | Railway UI custom build/start commands override railway.toml. If both are set and the UI has a typo, railway.toml is silently ignored. Fix b | `/Users/murali/.claude/skills/harvested/railway-toml-ui-precedence/SKILL.md` |
| `React Async-Callback State Snapshot Before Reset` | Bug pattern — when a handler resets React state synchronously AND fires an async mutation whose `onSuccess` later needs that same state, the | `/Users/murali/.claude/skills/harvested/react-async-state-snapshot/SKILL.md` |
| `React Error Object Rendering Guard` | Prevent React error #31 when API proxy/intermediary returns {code, message} objects instead of {error: string} — always coerce error state t | `/Users/murali/.claude/skills/harvested/react-error-object-guard/SKILL.md` |
| `ReactFlow Node Data Persistence` | Fix silent data loss in ReactFlow editors where elementsToNodes/nodesToElements serialization drops custom fields like tag bindings, animati | `/Users/murali/.claude/skills/harvested/reactflow-data-persistence/SKILL.md` |
| `referer-based-admin-page-no-password` | Build a low-friction admin UI for internal tools — standalone HTML page served from your domain + serverless API endpoint that checks Origin | `/Users/murali/.claude/skills/harvested/referer-based-admin-page-no-password/SKILL.md` |
| `Responsive shadcn Dialog with Pinned Header/Footer and Scrollable Body` | Make a shadcn (Radix UI) `<DialogContent>` responsive on small viewports — body content scrolls inside the dialog while the header (title) a | `/Users/murali/.claude/skills/harvested/shadcn-dialog-responsive-scrollable/SKILL.md` |
| `rsync Deploy Protection in a Directory Shared with Human-Managed Files` | Your deploy script rsyncs a repo subtree into a directory that *also* contains files maintained outside the repo (a public landing page, ad- | `/Users/murali/.claude/skills/harvested/rsync-deploy-shared-dir-protection/SKILL.md` |
| `SCADA Real-Time ReactFlow — Complete Debugging Case Study` | 12-issue chain that prevented live PLC tag values from updating ReactFlow HMI elements. Documents every failure point and the final working  | `/Users/murali/.claude/skills/harvested/scada-realtime-reactflow-debugging/SKILL.md` |
| `SCADA Screen Persistence Pattern` | HMI screens stored in Zustand must persist to database via API — loadScreens on mount, save on create/update/delete | `/Users/murali/.claude/skills/harvested/screen-persistence-pattern/SKILL.md` |
| `SCADA Tag Autocomplete Component` | Inline searchable dropdown for selecting PLC/SCADA tags scoped to the active project — fetches once, filters client-side | `/Users/murali/.claude/skills/harvested/scada-tag-autocomplete/SKILL.md` |
| `Screenshot-to-Root-Cause Error Diagnosis` | Decode minified React/production errors from browser screenshots — decode error URLs, trace stack traces, identify the actual component and  | `/Users/murali/.claude/skills/harvested/screenshot-error-diagnosis/SKILL.md` |
| `Self-Updating Cron Script via Remote Fetch and Atomic Re-Exec` | A long-running cron script installed at `/usr/local/bin/foo.sh` is a frozen snapshot of the day it was installed — every logic change requir | `/Users/murali/.claude/skills/harvested/self-updating-cron-script/SKILL.md` |
| `send-to-brain-slack-message-shortcut` | Add a "Send to Brain" message shortcut to a Slack bot so users can right-click any message → ingest the entire thread (parent + replies, res | `/Users/murali/.claude/skills/harvested/send-to-brain-slack-message-shortcut/SKILL.md` |
| `shared-vps-coexistence` | Operational rules and procedures for safely adding a new product to a busy multi-tenant Linux VPS (Hostinger, DigitalOcean droplet, EC2, bar | `/Users/murali/.claude/skills/harvested/shared-vps-coexistence/SKILL.md` |
| `silent-out-of-scope-no-enumeration` |  | `/Users/murali/.claude/skills/harvested/silent-out-of-scope-no-enumeration/SKILL.md` |
| `slack-bot-permanent-on-macos-launchd` | Run a Slack bot 24/7 on your Mac without deploying to cloud. Uses @slack/bolt Socket Mode (no inbound port needed) wrapped in a launchd plis | `/Users/murali/.claude/skills/harvested/slack-bot-permanent-on-macos-launchd/SKILL.md` |
| `Sliding Window Dedup Guard` | Time-windowed event counting with three dedup layers (memory Map, database query, cooldown period) for rate-sensitive detectors that must av | `/Users/murali/.claude/skills/harvested/sliding-window-dedup-guard/SKILL.md` |
| `Socket.IO Room Subscription Chain` | Complete the subscribe chain — frontend store must emit subscribe event to server, server must join client to room, then room-scoped emit wo | `/Users/murali/.claude/skills/harvested/socketio-room-subscription-chain/SKILL.md` |
| `Soft-Delete via hidden Flag for Reversible Dedupe` | Instead of `delete from`, mark duplicate or stale records with `hidden=true` and have every list view filter `hidden=false` by default with  | `/Users/murali/.claude/skills/harvested/soft-delete-hidden-flag/SKILL.md` |
| `Split Auth Modal — Sign-In vs Sign-Up Mode` | Single AuthModal component with a `mode` prop that drives distinct UX flows — sign-in rejects new users, sign-up shows details form for new  | `/Users/murali/.claude/skills/harvested/split-auth-modal-signin-signup/SKILL.md` |
| `stateful-cli-as-http-service` | Wrap a stateful or interactive CLI (claude, gh copilot, REPL tools) as an HTTP service. Covers the subset of CLI-bridge problems the plain c | `/Users/murali/.claude/skills/harvested/stateful-cli-as-http-service/SKILL.md` |
| `Subscription vs Pay-As-You-Go API Key Billing Mismatch (Insufficient-Balance Despite Valid Plan)` | When a SaaS / LLM provider returns "insufficient balance" or 4xx-billing errors despite an active, paid subscription, the most common cause  | `/Users/murali/.claude/skills/harvested/subscription-vs-payg-api-key-billing-mismatch/SKILL.md` |
| `Supabase Owner-Only Storage + RLS for Sensitive Per-User PII` | When a Supabase app needs to store sensitive per-user files (KYC docs, ID cards, medical reports, financial records) such that only the file | `/Users/murali/.claude/skills/harvested/supabase-owner-only-storage-pii/SKILL.md` |
| `Supabase Polling Overload — Diagnosis and Fix` | When Supabase shows millions of DB requests from a React app, the cause is almost always cascading React Query refetchIntervals and unguarde | `/Users/murali/.claude/skills/harvested/supabase-polling-overload-fix/SKILL.md` |
| `Supabase SQL → Clipboard Workflow` | When `supabase db push` is blocked by historical unapplied migrations on a linked project, copy each new migration's SQL to the macOS clipbo | `/Users/murali/.claude/skills/harvested/supabase-sql-clipboard-workflow/SKILL.md` |
| `Supabase Tenant Filtering via Inner Joins` | Use !inner join + dot-notation filtering to scope Supabase queries through related tables for multi-tenant isolation | `/Users/murali/.claude/skills/harvested/supabase-tenant-filtering/SKILL.md` |
| `supabase-multi-tenant-rls-jwt-claims` | Full recipe for multi-tenant SaaS isolation on Supabase using Postgres Row Level Security and JWT custom claims. Covers the profiles ↔ auth. | `/Users/murali/.claude/skills/harvested/supabase-multi-tenant-rls-jwt-claims/SKILL.md` |
| `SVG Sanitization with DOMPurify` | Replace regex-based SVG sanitizers with DOMPurify SVG profile — regex is trivially bypassable | `/Users/murali/.claude/skills/harvested/svg-sanitization-dompurify/SKILL.md` |
| `svg-icons-html-pdf` |  | `/Users/murali/.claude/skills/harvested/svg-icons-html-pdf/SKILL.md` |
| `template-and-instance-document-pair` |  | `/Users/murali/.claude/skills/harvested/template-and-instance-document-pair/SKILL.md` |
| `three-tier-milestone-hierarchy` |  | `/Users/murali/.claude/skills/harvested/three-tier-milestone-hierarchy/SKILL.md` |
| `Timezone-Aware Hourly Cron Fanout` | Run an hourly cron that uses Intl.DateTimeFormat to check each user's local hour — only deliver to users whose timezone hour matches the tar | `/Users/murali/.claude/skills/harvested/timezone-aware-cron-fanout/SKILL.md` |
| `Token-Saving Toolkit Install` | One-stop install procedure for the 5 Claude Code tools that cut token / API spend the most — Graphify (codebase knowledge graph), Firecrawl  | `/Users/murali/.claude/skills/harvested/token-saving-toolkit-install/SKILL.md` |
| `Vercel Prebuilt Deploy Workaround` | When Vercel remote builds fail silently (empty error message), build locally with vercel build --prod then deploy with vercel deploy --prebu | `/Users/murali/.claude/skills/harvested/vercel-prebuilt-deploy/SKILL.md` |
| `vercel-frontend-vps-backend-split` | Topology pattern when the frontend is on Vercel (auto-deploy from GitHub) but the backend (API + DB + workers) lives on a separate self-host | `/Users/murali/.claude/skills/harvested/vercel-frontend-vps-backend-split/SKILL.md` |
| `Vite Environment URL Auto-Detection` | Frontend apps deployed to Vercel must auto-detect API/WebSocket URLs for production vs development — never default to localhost for both API | `/Users/murali/.claude/skills/harvested/vite-env-url-detection/SKILL.md` |
| `weasyprint-rest-api-pdf` | Fetch data from a Supabase REST API with curl (no app running), generate styled A4 PDFs per entity with Python WeasyPrint, upload each PDF b | `/Users/murali/.claude/skills/harvested/weasyprint-rest-api-pdf/SKILL.md` |
| `WhatsApp Instant Acknowledgment Before Slow Processing` | Send an immediate ack message to the user before kicking off a long-running operation (AI inference, email fetch, DB query). Prevents user t | `/Users/murali/.claude/skills/harvested/whatsapp-instant-ack/SKILL.md` |
| `WhatsApp Personalized Research Before Replying` | Before replying to any BNI member on WhatsApp, research their company, specialty, city, and prior conversation context. Never send generic r | `/Users/murali/.claude/skills/harvested/whatsapp-personalized-research/SKILL.md` |
| `WhatsApp Self-Chat Loop — Token Drain Diagnosis` | When LLM balance drains faster than expected on a WhatsApp bot, check for self-chat loop (bot replying to its own number) and oversized per- | `/Users/murali/.claude/skills/harvested/whatsapp-selfchat-token-drain/SKILL.md` |
| `Worker Read-Only DB Role Pattern` | Background workers (BullMQ, cron, etc.) should read operational data via a dedicated SELECT-only Postgres role with its own DATABASE_URL — n | `/Users/murali/.claude/skills/harvested/worker-readonly-db-role-pattern/SKILL.md` |
| `Z.AI (Zhipu GLM) Provider Config — OpenAI-Compatible Format` | Z.AI (bigmodel.cn / zhipuai.cn) uses OpenAI-compatible /chat/completions API. Setting api type to "anthropic-messages" appends /v1/messages  | `/Users/murali/.claude/skills/harvested/zai-openai-compatible-provider/SKILL.md` |
| `Z.AI GLM Coding Plan + Claude Code (Anthropic-Compatible Endpoint, Per-Slot Model Mapping)` | Configure Claude Code to use Z.AI's GLM Coding Plan (Lite / Pro / Max subscription) via the Anthropic-compatible endpoint at api.z.ai/api/an | `/Users/murali/.claude/skills/harvested/zai-coding-plan-claude-code/SKILL.md` |
| `Zero Mock, Zero Fallback — Honest Data or Honest Error` | Enforce strict no-mock, no-fallback policy across frontend and backend. API failure shows error, empty data shows blank — never fake data, n | `/Users/murali/.claude/skills/harvested/zero-mock-zero-fallback/SKILL.md` |
| `Zero-Hardcode Bottom-Up Integration Protocol` | 5-step mandatory build order for any data-display feature — Backend → Verify → Store → UI → Traceability. Prevents AI from hallucinating a " | `/Users/murali/.claude/skills/harvested/zero-hardcode-integration-protocol/SKILL.md` |

_Catalog auto-regenerated on every Claude Code session start. Do not edit between the IRONBARK markers, manual edits outside the block are preserved._

<!-- IRONBARK:END -->
