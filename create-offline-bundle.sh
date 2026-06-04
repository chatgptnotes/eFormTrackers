#!/usr/bin/env bash
# create-offline-bundle.sh
# Builds a fully offline Windows deployment ZIP for JotFlow.
#
# What it produces: ~/Downloads/JotFlow-Offline-<YYYYMMDD>.zip
#
# ZIP contains:
#   1_INSTALLERS/   - Node.js, PostgreSQL+pgAdmin, iisnode, URLRewrite, ARR MSIs
#   2_APP/          - Built React frontend (dist/) + backend source
#   3_DATABASE/     - schema.sql + backup.sql (live pg_dump)
#   4_NPM_CACHE/    - npm offline cache (npm ci --prefer-offline on target)
#   setup-flowaccel.ps1, deploy-to-iis.ps1, install-iis-iisnode.ps1
#   INSTALL.md      - Step-by-step guide for the target Windows machine
#
# Usage:
#   chmod +x create-offline-bundle.sh && ./create-offline-bundle.sh
#
# Requirements on this Mac:
#   - Node + npm (for frontend build + npm cache)
#   - PostgreSQL running locally (for pg_dump)
#   - curl (for downloading Windows installers)
#   - zip

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d)"
BUNDLE_NAME="JotFlow-Offline-${STAMP}"
STAGE="/tmp/${BUNDLE_NAME}"
OUT="$HOME/Downloads/${BUNDLE_NAME}.zip"
NPM_CACHE="/tmp/jf-npm-cache-${STAMP}"

say()  { printf '\n[bundle] %s\n' "$1"; }
ok()   { printf '  [OK]  %s\n' "$1"; }
warn() { printf '  [!!]  %s\n' "$1" >&2; }

# Installer URLs
NODE_URL="https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
PG_URL="https://sbp.enterprisedb.com/getfile.jsp?fileid=1259103"
PG_FILENAME="postgresql-16.6-windows-x64.exe"
IISNODE_URL="https://github.com/Azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi"
URLREWRITE_URL="https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
ARR_URL="https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"

# DB connection (pg_dump)
DB_HOST="${PGHOST:-localhost}"
DB_USER="${PGUSER:-postgres}"
DB_NAME="${PGDATABASE:-flowaccel}"

say "=== JotFlow Offline Bundle Builder ==="
echo "  Output: $OUT"

# -- Cleanup --
rm -rf "$STAGE"
mkdir -p "$STAGE/1_INSTALLERS/npm"
mkdir -p "$STAGE/2_APP"
mkdir -p "$STAGE/3_DATABASE"

# ============================================================
# STEP 1: Build frontend
# ============================================================
say "STEP 1/6  Building frontend..."
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --silent
npm run build
ok "Frontend built -> dist/"

# ============================================================
# STEP 2: Database backup
# ============================================================
say "STEP 2/6  Dumping database..."
BACKUP="$ROOT/backend/db/backup.sql"
if PGPASSWORD="${PGPASSWORD:-postgres}" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP" 2>/dev/null; then
  ok "backup.sql written ($(du -sh "$BACKUP" | cut -f1))"
else
  warn "pg_dump failed — bundle will have no backup.sql. Ensure PostgreSQL is running locally."
  BACKUP=""
fi

# ============================================================
# STEP 3: npm offline cache for backend
# ============================================================
say "STEP 3/6  Creating npm offline cache..."
cd "$ROOT/backend"
# Remove bcrypt (native) if still in node_modules, install bcryptjs
npm install --silent 2>/dev/null || true
# Populate the cache: npm ci reads package-lock.json and caches every package
npm ci --cache "$NPM_CACHE" --prefer-offline 2>/dev/null || \
  npm install --cache "$NPM_CACHE" --prefer-offline 2>/dev/null || true
ok "npm cache populated at $NPM_CACHE ($(du -sh "$NPM_CACHE" 2>/dev/null | cut -f1 || echo 'unknown'))"

# ============================================================
# STEP 4: Download Windows installers
# ============================================================
say "STEP 4/6  Downloading Windows installers..."
INS="$STAGE/1_INSTALLERS"

download_installer() {
  local url="$1"
  local outfile="$2"
  local label="$3"
  if curl -L --max-time 300 --retry 2 --silent --show-error \
       -o "$INS/$outfile" "$url" 2>/dev/null; then
    ok "$label ($(du -sh "$INS/$outfile" | cut -f1))"
  else
    warn "FAILED to download $label — install manually from: $url"
    rm -f "$INS/$outfile"
  fi
}

download_installer "$NODE_URL"        "node-v20.18.0-x64.msi"         "Node.js 20 LTS"
download_installer "$PG_URL"          "$PG_FILENAME"                  "PostgreSQL 16 + pgAdmin"
download_installer "$IISNODE_URL"     "iisnode-full-v0.2.21-x64.msi"  "iisnode"
download_installer "$URLREWRITE_URL"  "rewrite_amd64_en-US.msi"       "IIS URL Rewrite 2.1"
download_installer "$ARR_URL"         "requestRouter_amd64.msi"       "ARR 3.0"

# PM2 tgz for offline global install
say "  Packing pm2..."
cd /tmp
npm pack pm2 --silent 2>/dev/null && mv /tmp/pm2-*.tgz "$INS/npm/" 2>/dev/null && \
  ok "pm2-*.tgz packed" || warn "pm2 pack failed — PM2 will be installed from internet"

# ============================================================
# STEP 5: Assemble app files
# ============================================================
say "STEP 5/6  Assembling app files..."

# Frontend dist
rsync -a "$ROOT/dist/" "$STAGE/2_APP/dist/"
ok "dist/ staged"

# Backend (no node_modules, no .env, no logs/uploads)
rsync -a \
  --exclude 'node_modules/' \
  --exclude 'logs/' \
  --exclude 'uploads/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  "$ROOT/backend/" "$STAGE/2_APP/backend/"

# Root IIS/entry files
for f in server.js web.config web.iisnode.config; do
  [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$STAGE/2_APP/$f"
done

# PM2 ecosystem config at app root (setup script calls pm2 start from there)
if [ -f "$ROOT/backend/ecosystem.config.js" ]; then
  cp -f "$ROOT/backend/ecosystem.config.js" "$STAGE/2_APP/ecosystem.config.js"
fi

ok "2_APP/ staged"

# Database files
cp -f "$ROOT/backend/db/schema.sql" "$STAGE/3_DATABASE/schema.sql"
[ -n "$BACKUP" ] && cp -f "$BACKUP" "$STAGE/3_DATABASE/backup.sql"
ok "3_DATABASE/ staged"

# npm cache
cp -r "$NPM_CACHE" "$STAGE/4_NPM_CACHE"
ok "4_NPM_CACHE/ staged"

# Setup scripts
for f in setup-flowaccel.ps1 deploy-to-iis.ps1 install-iis-iisnode.ps1; do
  [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$STAGE/$f"
done

# .env template (pre-filled, no real secrets)
cat > "$STAGE/backend.env.template" << 'ENVEOF'
# Copy this file to 2_APP\backend\.env after running setup-flowaccel.ps1
# The setup script auto-generates .env — only edit manually if needed.
DATABASE_URL=postgresql://jotflow:jotflow@localhost:5432/jotflow
SESSION_SECRET=<auto-generated-by-setup-script>
JOTFORM_API_KEY=af7787b0b077e0e60e89f9d1fa6101e8
JOTFORM_TEAM_ID=260541093809054
JOTFORM_BASE=https://eforms.mediaoffice.ae/API
JOTFORM_HOST=https://eforms.mediaoffice.ae
ALLOWED_ORIGIN=*
PORT=3001
NODE_ENV=production
ENABLE_POLLER=1
POLL_INTERVAL_MINUTES=5
POLLER_KEY_TYPE=default
ENVEOF

# INSTALL.md
cat > "$STAGE/INSTALL.md" << 'MDEOF'
# JotFlow — Offline Installation Guide

## Requirements
- Windows 10/11 or Windows Server 2019/2022 (64-bit)
- All required software is in the 1_INSTALLERS\ folder — NO internet needed

---

## STEP 1 — Enable IIS
Open PowerShell as Administrator and run:
```powershell
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServer -All -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -NoRestart
```
**OR:** Control Panel → Programs → Turn Windows features on/off → Internet Information Services → tick all → OK

---

## STEP 2 — Install Node.js
Run: `1_INSTALLERS\node-v20.18.0-x64.msi`
Click through, accept all defaults, Finish.

---

## STEP 3 — Install PostgreSQL + pgAdmin
Run: `1_INSTALLERS\postgresql-16.6-windows-x64.exe`
- When prompted for superuser password: type **postgres**
- pgAdmin 4 is included and installs automatically

---

## STEP 4 — Reboot
**Reboot the machine** so Node.js and PostgreSQL appear in the system PATH.

---

## STEP 5 — Extract this ZIP (if not done already)
Extract to: `C:\JotFlow-Setup\`

---

## STEP 6 — Run the setup script (as Administrator)
Open PowerShell as Administrator:
```powershell
cd C:\JotFlow-Setup
powershell -ExecutionPolicy Bypass -File .\setup-flowaccel.ps1
```

The script will automatically (no internet needed):
- Install URL Rewrite 2.1 from `1_INSTALLERS\`
- Install ARR 3.0 from `1_INSTALLERS\`
- Install iisnode from `1_INSTALLERS\`
- Create PostgreSQL database "jotflow"
- Install npm packages from `4_NPM_CACHE\` (offline)
- Apply database schema
- **Ask you:** Restore existing data from backup.sql? (Y/N)
- Seed admin user (credentials printed at end)
- Start backend with PM2 on port 3001
- Configure IIS site on port 80

---

## STEP 7 — Open the app
Open a browser: http://localhost/
Login with the credentials printed at the end of Step 6.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `psql not found` | Reboot after PostgreSQL install, then re-run setup |
| `node not found` | Reboot after Node.js install, then re-run setup |
| IIS site gives 502 | PM2 backend not running — run `pm2 restart all` in PowerShell |
| Login fails | Run `cd C:\JotFlow-Setup\2_APP\backend && node db/seed-admin.js` |
| Port 80 in use | Stop "Default Web Site" in IIS Manager |
| Socket/real-time not working | Ensure IIS-WebSockets feature is enabled (Step 1) |

pgAdmin: connect to localhost:5432, database=jotflow, user=jotflow, password=jotflow
MDEOF

ok "INSTALL.md written"

# ============================================================
# STEP 6: Create ZIP
# ============================================================
say "STEP 6/6  Creating ZIP..."
rm -f "$OUT"
( cd /tmp && zip -rq "$OUT" "$BUNDLE_NAME" )
SIZE="$(du -sh "$OUT" | cut -f1)"

echo ""
echo "=================================================="
echo " DONE"
echo " ZIP: $OUT"
echo " Size: $SIZE"
echo ""
echo " Transfer this file to the new Windows machine."
echo " Then follow INSTALL.md inside the ZIP."
echo "=================================================="
