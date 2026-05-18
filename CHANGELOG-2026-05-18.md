# FlowAccel — Deployment Fixes Changelog

**Date:** 2026-05-18
**Server:** Windows 10 Pro · IIS · PostgreSQL 15 · Node.js v22 · `192.168.8.127`
**Application:** FlowAccel / JotFlow — React SPA + Node.js/Express backend + PostgreSQL
**Install location:** `C:\Website\flowaccel\`

---

## Overview

The FlowAccel setup package (`FlowAccel-Setup-1.0.7z`) was extracted to
`C:\Website\flowaccel\`, but the application would not run under IIS. Six separate
configuration problems were found and fixed, and a reusable deployment package was
created. This document records every change, in the order it was made.

---

## Issue 1 — HTTP 403.14: site would not open

**Symptom:** `http://192.168.8.127:8081/` returned *HTTP Error 403.14 — Forbidden*.

**Root cause:** The IIS site physical path pointed to `C:\Website\flowaccel`, but the
React build (`index.html` + `assets\`) lives inside the `dist\` sub-folder.
`index.html` uses absolute asset paths (`/assets/...`), so the IIS site root must be
the `dist\` folder. `web.config` was also in the parent folder, where IIS never loads it.

**Fix:**
- Re-pointed the IIS site physical path: `C:\Website\flowaccel` → `C:\Website\flowaccel\dist`
- Placed the corrected `web.config` inside `C:\Website\flowaccel\dist\`
- Set the IIS application pool to **No Managed Code**
- Granted `IIS_IUSRS` read access to the `dist` folder

---

## Issue 2 — ARR reverse proxy was disabled

**Root cause:** `web.config` reverse-proxies `/api`, `/socket.io`, `/uploads` to the
Node backend at `http://localhost:3001`. The Application Request Routing (ARR) module
was installed, but the server-level **Enable proxy** setting was OFF.

**Fix:** Enabled the ARR proxy at server level
(`system.webServer/proxy` → `enabled = true`).

---

## Issue 3 — HTTP 502: Node.js backend not running

**Symptom:** Pages loaded, but every API call returned *HTTP Error 502.3 — Bad Gateway*.

**Root cause:** The Node.js/Express backend (port 3001) was not running. The package's
intended process manager (PM2) failed on Windows with a named-pipe permission error
(`EPERM \\.\pipe\rpc.sock`).

**Fix:**
- Dropped PM2 (unreliable on Windows here).
- Created `backend\run-backend.cmd` — a launcher that runs the backend and
  auto-restarts it if it crashes.
- Registered a Windows Scheduled Task (`FlowAccelBackend`) that runs the launcher
  automatically so the backend starts on logon and survives crashes.

---

## Issue 4 — "Invalid credentials" on login

**Symptom:** Logging in with `bk@bettroi.com` always returned *Invalid credentials*.

**Root cause:** The PostgreSQL database was migrated (all tables present) but the
`users` table was empty — no account had ever been created.

**Fix:**
- Created the account `bk@bettroi.com` via the application's sign-up API.
- Set the account password.
- Promoted the account to the `super_admin` role (in `profiles` and `org_members`).

---

## Issue 5 — HTTPS enabled (required for Microsoft login)

**Root cause:** The Microsoft callback URL is `https://192.168.8.127/...` (HTTPS),
but the site was served only over plain HTTP on port 8081. Azure AD refuses plain
`http://` redirect URIs for non-localhost addresses.

**Fix:**
- Created a self-signed TLS certificate for `192.168.8.127` (valid 5 years).
- Added an IIS HTTPS binding on port 443.
- Opened the Windows Firewall for ports 443 and 8081.
- The site is now reachable at `https://192.168.8.127/` (HTTP 8081 still works).

---

## Issue 6 — Microsoft login: AADSTS50011 redirect URI mismatch

**Symptom:** *AADSTS50011: The redirect URI ... does not match the redirect URIs
configured for the application.*

**Root cause:** The callback URL was not registered in the Azure app registration.

**Fix:**
- Registered `https://192.168.8.127/api/auth/microsoft/callback` in the Azure Portal
  (App registration → Authentication → **Web** platform).
- Updated the backend `ALLOWED_ORIGIN` to include the HTTPS origin.
- Verified that Microsoft now accepts the redirect URI.

---

## web.config — changes

The rewrite rules were already correct for the reverse-proxy model. The problems
were the file's **location** and minor clean-up:

| Change | Before | After |
|--------|--------|-------|
| File location | `C:\Website\flowaccel\web.config` (parent — never loaded) | `C:\Website\flowaccel\dist\web.config` (inside the site root) |
| Hidden segments | Blocked `node_modules`, `backend`, `.env`, `.git` | Removed — those folders are outside the `dist\` site root anyway |
| Header comment | Referenced an old path | Updated to describe the correct layout |

What `web.config` (in `dist\`) does: reverse-proxies `/api`, `/socket.io`, `/uploads`
to `http://localhost:3001`; serves static files; SPA fallback to `index.html`;
default document; security headers; MIME types; 10 MB request limit.

---

## backend\.env — changes

| Setting | Before | After |
|---------|--------|-------|
| `ALLOWED_ORIGIN` | `http://192.168.8.127:8081` | `http://192.168.8.127:8081,https://192.168.8.127` |
| `MICROSOFT_REDIRECT_URI` | `https://192.168.8.127/api/auth/microsoft/callback` | unchanged (already correct) |

---

## Files created

| File | Purpose |
|------|---------|
| `dist\web.config` | Corrected IIS config, placed in the site root |
| `backend\run-backend.cmd` | Backend launcher with crash auto-restart |
| `host-flowaccel.ps1` | IIS setup: re-point site, enable ARR |
| `iis-setup.ps1` | Alternate IIS setup script |
| `install-backend-service.ps1` | Register backend as a permanent task |
| `setup-https.ps1` | Create certificate + HTTPS binding |
| `make-admin.ps1` / `fix-login.ps1` | Set admin account password + role |
| `MAKE-BACKEND-PERMANENT.bat` | One-click backend service installer |
| `deployment-report.html` | HTML troubleshooting report |
| `CHANGELOG-2026-05-18.md` | This document |

---

## Database changes

- Created application user account `bk@bettroi.com`.
- Set its password and `super_admin` role (`profiles` + `org_members`).
- (Schema and tables were already migrated.)

---

## IIS / Windows changes

- IIS site re-pointed to `C:\Website\flowaccel\dist`.
- ARR reverse proxy enabled at server level.
- Application pool set to **No Managed Code**.
- Self-signed TLS certificate created for `192.168.8.127`; HTTPS binding on port 443.
- Windows Firewall opened for ports 443 and 8081.
- Scheduled task registered so the backend starts automatically.

---

## Deployment package created

A reusable package (`FlowAccel-Deploy.zip`) was built so the app can be installed on
any other server without manual troubleshooting:

- `config.txt` — server-specific values (IP, ports, DB, admin, keys)
- `INSTALL.bat` + `install.ps1` — automated installer (IIS, HTTPS, DB, backend, firewall)
- `README.txt` — instructions
- `app\dist\` + `app\backend\` — the application files

The installer adapts to any IP/hostname — nothing is hard-coded.

---

## Final status

| Component | Status |
|-----------|--------|
| IIS hosting (HTTP 8081 + HTTPS 443) | Working |
| web.config + ARR reverse proxy | Working |
| PostgreSQL database | Working |
| Node.js backend (auto-start task) | Working |
| Email / password login (`super_admin`) | Working |
| HTTPS / TLS certificate | Working |
| Microsoft (Azure AD) login | Working |

Application is live at `https://192.168.8.127/`.
