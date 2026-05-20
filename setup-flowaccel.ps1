# =======================================================================
#  FlowAccel - ONE-SHOT installer (RUN AS ADMINISTRATOR)
#
#  Goal: on ANY fresh Windows machine, get from zero to a working login.
#  Steps it performs:
#    1. Verify prerequisites (Node, PostgreSQL, PM2)
#    2. Create local PostgreSQL DB + role  (jotflow)
#    3. Write backend\.env  (local DB, random session secret, port 3000)
#    4. npm install (backend) if needed
#    5. Apply schema  (db/migrate.js)
#    6. Seed default admin user  (db/seed-admin.js)
#    7. Start backend with PM2 on port 3000
#    8. Deploy frontend to IIS  (calls deploy-to-iis.ps1)
#
#  After it finishes: open http://localhost/ and log in with the admin
#  credentials printed at the end. pgAdmin connects to localhost:5432 / jotflow.
# =======================================================================

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'

# -- Tunable defaults (override by setting env vars before running) --
$DbName     = if ($env:FA_DB_NAME)     { $env:FA_DB_NAME }     else { 'jotflow' }
$DbUser     = if ($env:FA_DB_USER)     { $env:FA_DB_USER }     else { 'jotflow' }
$DbPassword = if ($env:FA_DB_PASSWORD) { $env:FA_DB_PASSWORD } else { 'jotflow' }
$DbHost     = if ($env:FA_DB_HOST)     { $env:FA_DB_HOST }     else { 'localhost' }
$DbPort     = if ($env:FA_DB_PORT)     { $env:FA_DB_PORT }     else { '5432' }
$AdminEmail = if ($env:ADMIN_EMAIL)    { $env:ADMIN_EMAIL }    else { 'admin@flowaccel.local' }
$AdminPass  = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { 'Admin@12345' }
$BackendPort = $null    # chosen dynamically below (first free of 3001, 3000, else an OS-assigned free port)

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK]  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]   $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [X]   $m" -ForegroundColor Red; exit 1 }

# Returns $true if something is already LISTENING on the given TCP port.
function Test-PortListening($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

# Pick the backend port DYNAMICALLY: prefer 3001, then 3000, otherwise let the
# OS hand us any free loopback port. The backend is loopback-only (IIS proxies
# to it), so any free port works - it just has to match what web.config proxies
# to, which deploy-to-iis.ps1 reads back from backend\.env.
function Get-FreeBackendPort {
  foreach ($p in 3001, 3000) {
    if (-not (Test-PortListening $p)) { return $p }
  }
  $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $l.Start()
  $p = $l.LocalEndpoint.Port
  $l.Stop()
  return $p
}

# -- 0. Elevation --
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die 'Not running as Administrator. Right-click PowerShell, Run as Administrator.'
}

# -- 1. Prerequisites --
Step '1/8  Checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'Node.js not found. Install Node 18+ from https://nodejs.org and re-run.'
}
Ok "Node $(node -v)"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Die 'psql (PostgreSQL client) not found in PATH. Install PostgreSQL 14+ and add its bin folder to PATH, then re-run.'
}
Ok 'psql found'

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Warn 'PM2 not found - installing globally...'
  npm install -g pm2 | Out-Null
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { Die 'PM2 install failed.' }
}
Ok 'PM2 present'

# -- 2. Create DB + role --
# Uses the postgres superuser. If your superuser password differs, set
# $env:PGPASSWORD before running, or run the SQL manually in pgAdmin.
Step '2/8  Creating PostgreSQL database + role'

if (-not $env:PGPASSWORD) { $env:PGPASSWORD = 'postgres' }

# Create role (a harmless error if it already exists - ON_ERROR_STOP off).
& psql -h $DbHost -p $DbPort -U postgres -d postgres -v ON_ERROR_STOP=0 `
  -c "CREATE ROLE $DbUser LOGIN PASSWORD '$DbPassword'" 2>&1 | Out-Host
# Always sync the password (and LOGIN) to the known value, in case the role
# already existed with an unknown password (e.g. left over from a dump restore
# whose original owner role we are re-creating here).
& psql -h $DbHost -p $DbPort -U postgres -d postgres -v ON_ERROR_STOP=0 `
  -c "ALTER ROLE $DbUser LOGIN PASSWORD '$DbPassword'" 2>&1 | Out-Null

$dbExists = (& psql -h $DbHost -p $DbPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null)
if ($dbExists -ne '1') {
  & psql -h $DbHost -p $DbPort -U postgres -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser" 2>&1 | Out-Host
  Ok "database '$DbName' created"
} else {
  Ok "database '$DbName' already exists"
}
& psql -h $DbHost -p $DbPort -U postgres -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser" 2>&1 | Out-Null

# -- 3. Write backend\.env --
Step '3/8  Writing backend env file'

$envPath = Join-Path $backend '.env'

# Decide the backend port DYNAMICALLY. If an .env already exists, keep whatever
# PORT it declares (so we never fight a running install). Otherwise pick the
# first free port (3001 -> 3000 -> OS-assigned).
if (Test-Path $envPath) {
  if ((Get-Content $envPath -Raw) -match '(?m)^\s*PORT\s*=\s*(\d+)') { $BackendPort = $Matches[1] }
}
if (-not $BackendPort) { $BackendPort = "$(Get-FreeBackendPort)" }
Ok "backend port selected: $BackendPort"

if (Test-Path $envPath) {
  Warn ".env already exists - leaving it untouched (PORT=$BackendPort). Delete it first for a clean regenerate."
} else {
  $sessionSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $databaseUrl = "postgresql://${DbUser}:${DbPassword}@${DbHost}:${DbPort}/${DbName}"
  $lines = @(
    '# Auto-generated by setup-flowaccel.ps1'
    "DATABASE_URL=$databaseUrl"
    "SESSION_SECRET=$sessionSecret"
    ''
    '# JotForm API (optional offline - workspace gate bypassed in development)'
    'JOTFORM_API_KEY='
    'JOTFORM_TEAM_ID='
    'JOTFORM_BASE=https://eforms.mediaoffice.ae/API'
    'JOTFORM_HOST=https://eforms.mediaoffice.ae'
    ''
    '# CORS / Server'
    'ALLOWED_ORIGIN=*'
    "PORT=$BackendPort"
    'NODE_ENV=development'
  )
  Set-Content -Path $envPath -Value $lines -Encoding utf8
  Ok ".env written (DB=$DbName, port=$BackendPort, NODE_ENV=development)"
}

# -- 4. npm install --
Step '4/8  Installing backend dependencies'
Push-Location $backend
if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
  npm install | Out-Host
  Ok 'npm install complete'
} else {
  Ok 'node_modules present - skipping'
}

# -- 5. Apply schema --
Step '5/8  Applying database schema'
node db/migrate.js
Ok 'schema applied'

# -- 5b. Auto-repair ownership + privileges (dump-restore safety) --
# This is the fix for the classic dump-restore mismatch: a dump restored under
# the postgres superuser leaves every table OWNED BY postgres, so the jotflow
# app role gets "permission denied for table users" on the first login. We:
#   1. Transfer ownership of all public tables/sequences to the app role, and
#   2. GRANT read/write on all current + future objects.
# Single-quoted here-string so PowerShell does not mangle the plpgsql $do$
# dollar-quoting; __ROLE__ is then substituted with the real role name.
$repairSql = @'
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '__ROLE__');
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequencename, '__ROLE__');
  END LOOP;
END
$do$;
GRANT ALL ON SCHEMA public TO __ROLE__;
GRANT ALL ON ALL TABLES IN SCHEMA public TO __ROLE__;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO __ROLE__;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO __ROLE__;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO __ROLE__;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO __ROLE__;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO __ROLE__;
'@ -replace '__ROLE__', $DbUser
$tmpSql = Join-Path $env:TEMP 'flowaccel-db-repair.sql'
Set-Content -Path $tmpSql -Value $repairSql -Encoding ASCII
& psql -h $DbHost -p $DbPort -U postgres -d $DbName -v ON_ERROR_STOP=0 -f $tmpSql 2>&1 | Out-Null
Remove-Item $tmpSql -Force -ErrorAction SilentlyContinue
Ok "ownership transferred + privileges granted on '$DbName' to role '$DbUser'"

# Post-check: confirm the app role can actually SEE its core table. If the
# jotflow DB exists but has no 'users' table, the data was probably restored
# into a DIFFERENT database name - tell the operator exactly what to do.
$hasUsers = (& psql -h $DbHost -p $DbPort -U postgres -d $DbName -tAc "SELECT to_regclass('public.users') IS NOT NULL" 2>$null)
if ("$hasUsers".Trim() -ne 't') {
  Warn "Database '$DbName' has no 'users' table. If you restored a dump, it likely went into a DIFFERENT database name."
  Warn "Fix: restore the dump INTO '$DbName' (or set FA_DB_NAME), then re-run this script. The app/.env expect db='$DbName', role='$DbUser'."
} else {
  Ok "verified: '$DbName' contains the expected schema (public.users present)"
}

# -- 6. Seed admin --
Step '6/8  Seeding default admin user'
$env:ADMIN_EMAIL = $AdminEmail
$env:ADMIN_PASSWORD = $AdminPass
node db/seed-admin.js
Ok 'admin seeded'

# -- 7. Start backend (PM2) --
Step '7/8  Starting backend with PM2'
pm2 delete jotflow-backend 2>$null | Out-Null
pm2 start ecosystem.config.js 2>&1 | Out-Host

# Register pm2 to auto-start on boot so the backend survives reboots (otherwise
# after a restart IIS is up but the backend is dead and every /api call 502s).
if (-not (Get-Command pm2-startup -ErrorAction SilentlyContinue)) {
  Warn 'pm2-windows-startup not found - installing globally...'
  npm install -g pm2-windows-startup 2>&1 | Out-Null
}
if (Get-Command pm2-startup -ErrorAction SilentlyContinue) {
  pm2-startup install 2>&1 | Out-Null
  Ok 'pm2 registered to start on boot (pm2-windows-startup)'
} else {
  Warn 'pm2-windows-startup unavailable - backend will NOT auto-start after reboot. Install it manually: npm i -g pm2-windows-startup; pm2-startup install'
}
pm2 save 2>&1 | Out-Null
Ok "backend running on http://localhost:$BackendPort (saved for boot resurrection)"
Pop-Location

# -- 8. Deploy frontend to IIS --
Step '8/8  Deploying frontend to IIS'
$deploy = Join-Path $root 'deploy-to-iis.ps1'
if (Test-Path $deploy) {
  & $deploy
  Ok 'IIS deploy script finished'
} else {
  Warn 'deploy-to-iis.ps1 not found - skipped. Deploy the dist folder to IIS manually.'
}

# -- Done --
Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host ' FlowAccel is ready.' -ForegroundColor Green
Write-Host "   Open:     http://localhost/" -ForegroundColor Green
Write-Host "   Login:    $AdminEmail" -ForegroundColor Green
Write-Host "   Password: $AdminPass   (change after first login)" -ForegroundColor Green
Write-Host "   pgAdmin:  $DbHost : $DbPort  db=$DbName  user=$DbUser" -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Green
Write-Host ''
