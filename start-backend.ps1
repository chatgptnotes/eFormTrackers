# =====================================================================
#  FlowAccel - start the Node.js backend on port 3001 (with PM2)
#  RUN AS ADMINISTRATOR the first time (so PM2 can install as a service)
# =====================================================================

$ErrorActionPreference = 'Stop'
$backend = 'C:\Website\flowaccel\backend'
Set-Location $backend

# Install PM2 once (skips if already installed)
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "Installing PM2..." -ForegroundColor Cyan
    npm install -g pm2 pm2-windows-startup
    pm2-startup install
}

# (One time only) create database tables - uncomment if not migrated yet:
# node db/migrate.js

Write-Host "Starting backend with PM2..." -ForegroundColor Cyan
pm2 start ecosystem.config.js
pm2 save

Write-Host ""
Write-Host "Backend started. Test:  curl http://localhost:3001/api/health" -ForegroundColor Green
pm2 status
