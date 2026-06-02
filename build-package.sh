#!/usr/bin/env bash
# build-package.sh - macOS/Unix equivalent of build-package.ps1.
# Builds ONE deployable FlowAccel package zip for a fresh Windows + IIS machine.
#
# Output: <OUT_DIR>/FlowAccel-Deploy-<yyyyMMdd-HHmm>.zip
#   (OUT_DIR defaults to <repo>/deploy-output; override with arg 1)
#
# Usage:
#   ./build-package.sh                 # zip into ./deploy-output
#   ./build-package.sh ~/Downloads     # zip into ~/Downloads
#   SKIP_FRONTEND_BUILD=1 ./build-package.sh   # reuse existing dist/
#   INCLUDE_INSTALLER=1 ./build-package.sh     # also bundle the ~791MB installer chunks
#
# On the target Windows machine (Node 18+ and PostgreSQL 14+ on PATH, run as Admin):
#   1. Extract the zip   2. .\setup-flowaccel.ps1   3. open http://localhost/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$ROOT/deploy-output}"
say() { printf '[build] %s\n' "$1"; }

# -- 1. Build the frontend (-> dist/) --
if [ "${SKIP_FRONTEND_BUILD:-0}" != "1" ]; then
  say "Building frontend (npm run build)..."
  ( cd "$ROOT/frontend" && { [ -d node_modules ] || npm install; } && npm run build )
fi
[ -d "$ROOT/dist" ] || { echo "ERROR: dist/ not found. Build the frontend first." >&2; exit 1; }

# -- 2. Stage a clean deploy tree --
mkdir -p "$OUT_DIR"
STAGE="$OUT_DIR/FlowAccel-Deploy"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Frontend build. By default exclude the big dist/installer download chunks (~791MB)
# - they are an end-user download artifact, not needed to run the app.
if [ "${INCLUDE_INSTALLER:-0}" = "1" ]; then
  say "Staging dist/ (with the installer download chunks)..."
  rsync -a "$ROOT/dist/" "$STAGE/dist/"
else
  say "Staging dist/ (excluding the ~791MB installer download chunks)..."
  rsync -a --exclude 'installer/' "$ROOT/dist/" "$STAGE/dist/"
fi

# Backend. Exclude secrets, runtime data, and node_modules (installed on target).
say "Staging backend/ (excluding node_modules, logs, uploads, .env*)..."
rsync -a \
  --exclude 'node_modules/' --exclude 'logs/' --exclude 'uploads/' \
  --exclude '.env' --exclude '.env.production' --exclude '.env.local' --exclude '.env.vercel-check' \
  "$ROOT/backend/" "$STAGE/backend/"

# Root files + the deploy scripts the target runs.
say "Staging root files + deploy scripts..."
for f in server.js web.config web.iisnode.config setup-flowaccel.ps1 \
         deploy-to-iis.ps1 install-iis-iisnode.ps1 DEPLOY.md; do
  [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$STAGE/$f"
done
# pm2 ecosystem config must sit at the deploy root (setup-flowaccel.ps1 runs
# `pm2 start ecosystem.config.js` from here, pointing at the root server.js).
if [ -f "$ROOT/ecosystem.config.js" ]; then
  cp -f "$ROOT/ecosystem.config.js" "$STAGE/ecosystem.config.js"
elif [ -f "$ROOT/backend/ecosystem.config.js" ]; then
  cp -f "$ROOT/backend/ecosystem.config.js" "$STAGE/ecosystem.config.js"
fi

# -- 3. Zip it --
STAMP="$(date +%Y%m%d-%H%M)"
ZIP="$OUT_DIR/FlowAccel-Deploy-$STAMP.zip"
rm -f "$ZIP"
say "Compressing -> $ZIP"
( cd "$STAGE" && zip -rq "$ZIP" . )
SIZE="$(du -h "$ZIP" | cut -f1)"

echo
echo "DONE: $ZIP  ($SIZE)"
echo
echo "On the NEW Windows machine (Node 18+ and PostgreSQL 14+ on PATH, run as Administrator):"
echo "  1. Copy and extract the zip."
echo "  2. Open PowerShell as Administrator in the extracted folder."
echo "  3. Run:   .\\setup-flowaccel.ps1"
echo "  Then open http://localhost/  (login printed at the end of the script)."
