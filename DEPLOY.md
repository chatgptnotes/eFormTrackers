# FlowAccel - Hosting on Windows + IIS

This project can be hosted on any fresh Windows 10/11 Pro or Windows Server 2016+
machine. There are two supported ways. Both now handle the six failure points
that previously broke a hand deployment (see "What was fixed" below).

## Option A (recommended): the self-contained installer

Download `FlowAccel-Setup-1.0.4.exe` (login page download, or build it from
`FlowAccel Installer/`) and run it as Administrator. It installs Node 18,
PostgreSQL 15, IIS + URL Rewrite + ARR, NSSM, creates the `jotflow` DB + role,
applies the schema, grants privileges, registers the backend as a Windows
service, and serves the site on port 80. If any dependency fails it aborts,
shows the error, and rolls back. Logs are browsable at `http://<host>/logs/`.

Backend runs as the **FlowAccelBackend** NSSM service on **port 3001**.

## Option B: manual one-shot scripts (pm2 + IIS)

On a machine that already has Node 18 + PostgreSQL installed and on PATH:

```powershell
# Run PowerShell as Administrator, from the project folder:
.\setup-flowaccel.ps1
```

`setup-flowaccel.ps1` does everything end-to-end:
1. Checks Node / psql / pm2 (installs pm2 if missing).
2. Creates the `jotflow` PostgreSQL database **and role**.
3. Writes `backend\.env` (DB URL, random session secret, **PORT=3001**).
4. `npm install`, applies the schema (`db/migrate.js`).
5. **Grants** the `jotflow` role full access to all objects (so a restored dump
   owned by `postgres` still works).
6. Seeds the default admin user.
7. Starts the backend with pm2 and **registers pm2 to start on boot**.
8. Deploys the frontend to IIS via `deploy-to-iis.ps1`, which also **installs
   URL Rewrite + ARR if missing** and enables the ARR reverse proxy.

Backend runs under **pm2** on **port 3001** (matches `web.config`).

## What was fixed (the six failure points)

| # | Problem | Fix |
|---|---------|-----|
| 1 | URL Rewrite + ARR not installed | `deploy-to-iis.ps1` now downloads + installs both if the registry key is missing |
| 2 | ARR proxy switch off | `deploy-to-iis.ps1` enables `system.webServer/proxy` (after installing the modules) |
| 3 | pm2 forced dev mode / port 3000 over `.env` | `ecosystem.config.js` no longer sets `env`; `.env` is the single source of truth. Everything standardised on **port 3001** (`.env`, `web.config`, installer) |
| 4 | pm2 not surviving reboot | `setup-flowaccel.ps1` installs `pm2-windows-startup` and runs `pm2 save` |
| 5 | `jotflow` role missing after a DB dump restore | `setup-flowaccel.ps1` creates the role explicitly (idempotent). See caveat below |
| 6 | DB name mismatch / tables owned by `postgres` | `setup-flowaccel.ps1` grants the `jotflow` role full privileges + default privileges after the schema step |

## IMPORTANT - restoring a database dump

A single-database `pg_dump` does **not** contain roles (they are cluster-level)
and may use a different database name. If you restore a dump:

- Restore it **into the `jotflow` database** (or set `FA_DB_NAME` before running
  the script). The app/`.env` expect the DB named `jotflow`.
- Make sure the **`jotflow` login role exists** - `setup-flowaccel.ps1` creates
  it, or create it manually:
  `CREATE ROLE jotflow LOGIN PASSWORD 'jotflow';`
- Re-run the **grant block** (step 5 of the script) so `jotflow` can read tables
  the dump created under `postgres`.
- To carry roles automatically next time, dump with **`pg_dumpall`** instead of
  `pg_dump`.

## Port reference

| Thing | Port |
|-------|------|
| IIS site (frontend + reverse proxy) | 80 |
| Node backend (pm2 or NSSM) | 3001 |
| PostgreSQL | 5432 |

`web.config` reverse-proxies `/api`, `/socket.io`, `/uploads` to
`http://localhost:3001`. If you change the backend port, change it in `.env`
**and** `web.config` together.
