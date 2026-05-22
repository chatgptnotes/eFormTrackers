# build-package.ps1 - Build ONE deployable FlowAccel package for a fresh
# Windows + IIS machine. Pure ASCII (Windows PowerShell 5.1 safe).
#
# Output: deploy-output\FlowAccel-Deploy-<yyyyMMdd-HHmm>.zip
#
# Run on your dev machine:
#   powershell -ExecutionPolicy Bypass -File build-package.ps1
#   (or:  npm run package)
#
# Then on the NEW Windows machine (prerequisites: Node 18+ and PostgreSQL 14+
# installed and on PATH; internet for npm; run as Administrator):
#   1. Copy + extract the zip
#   2. .\setup-flowaccel.ps1
#   Open http://localhost/
#
# setup-flowaccel.ps1 then: installs URL Rewrite + ARR, creates the DB + role,
# applies the schema, seeds the admin, starts the backend on the first FREE port
# (3001 -> 3000 -> any), registers pm2 for reboot, and deploys the site to IIS:80.

[CmdletBinding()]
param(
  [string]$OutDir,                   # default: <repo>\deploy-output (set below)
  [switch]$SkipFrontendBuild,        # reuse the existing dist\ instead of rebuilding
  [switch]$IncludeInstallerDownload  # also bundle the ~791MB /installer download chunks
)
$ErrorActionPreference = 'Stop'

# Resolve the script's own folder robustly (PSScriptRoot can be empty depending
# on how the script is invoked).
$root = if ($PSScriptRoot) { $PSScriptRoot }
        elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
        else { (Get-Location).Path }
if (-not $OutDir) { $OutDir = Join-Path $root 'deploy-output' }
function Say($m) { Write-Host "[build] $m" -ForegroundColor Cyan }

# -- 1. Build the frontend (-> dist\) --
if (-not $SkipFrontendBuild) {
  Say 'Building frontend (npm run build)...'
  Push-Location (Join-Path $root 'frontend')
  try {
    if (-not (Test-Path 'node_modules')) { npm install | Out-Host }
    npm run build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed (see output above).' }
  } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $root 'dist'))) {
  throw 'dist\ not found. Run without -SkipFrontendBuild, or build the frontend first.'
}

# -- 2. Stage a clean deploy tree --
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stage = Join-Path $OutDir 'FlowAccel-Deploy'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Frontend build. By default exclude the big /installer download chunks (~791MB)
# - they are an end-user download artifact, not needed to run the app.
$distSrc = Join-Path $root 'dist'
$distDst = Join-Path $stage 'dist'
if ($IncludeInstallerDownload) {
  Say 'Staging dist\ (with the installer download chunks)...'
  robocopy $distSrc $distDst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
} else {
  Say 'Staging dist\ (excluding the ~791MB installer download chunks)...'
  robocopy $distSrc $distDst /MIR /NFL /NDL /NJH /NJS /NP /XD (Join-Path $distSrc 'installer') | Out-Null
}

# Backend. Exclude secrets, runtime data and node_modules (installed on target).
Say 'Staging backend\ (excluding .env, logs, uploads, node_modules)...'
robocopy (Join-Path $root 'backend') (Join-Path $stage 'backend') /MIR /NFL /NDL /NJH /NJS /NP `
  /XD node_modules logs uploads /XF .env .env.production .env.local .env.vercel-check | Out-Null

# Root files + the deploy scripts the target runs.
Say 'Staging root files + deploy scripts...'
foreach ($f in 'server.js','web.config','web.iisnode.config','ecosystem.config.js',
                'setup-flowaccel.ps1','deploy-to-iis.ps1','install-iis-iisnode.ps1','DEPLOY.md') {
  $srcF = Join-Path $root $f
  if (Test-Path $srcF) { Copy-Item $srcF (Join-Path $stage $f) -Force }
}

# -- 3. Zip it --
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$zip = Join-Path $OutDir "FlowAccel-Deploy-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Say "Compressing -> $zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host ''
Write-Host "DONE: $zip  ($sizeMB MB)" -ForegroundColor Green
Write-Host ''
Write-Host 'On the NEW Windows machine (Node 18+ and PostgreSQL 14+ on PATH, run as Administrator):' -ForegroundColor Yellow
Write-Host '  1. Copy and extract the zip.'
Write-Host '  2. Open PowerShell as Administrator in the extracted folder.'
Write-Host '  3. Run:   .\setup-flowaccel.ps1'
Write-Host '  Then open http://localhost/  (login printed at the end of the script).'
Write-Host ''
Write-Host 'No Node/PostgreSQL on the target? Use the self-contained FlowAccel-Setup-*.exe' -ForegroundColor DarkGray
Write-Host 'installer instead (FlowAccel Installer\\), which bundles Node + PostgreSQL + IIS modules.' -ForegroundColor DarkGray
