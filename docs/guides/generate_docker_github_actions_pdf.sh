#!/usr/bin/env bash
# Render the beginner Docker deployment guide with local Chrome/Chromium.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML="$HERE/Docker-GitHub-Actions-Windows-Deployment-Guide.html"
PDF="$HERE/JotFlow-Docker-GitHub-Actions-Windows-Deployment-Guide.pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then CHROME="$(command -v chromium || command -v chrome || true)"; fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then echo "Chrome or Chromium is required to render the PDF." >&2; exit 1; fi
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf-no-header --user-data-dir="$PROFILE" --print-to-pdf="$PDF" --virtual-time-budget=10000 "file://$HTML" >/dev/null 2>&1
echo "Wrote: $PDF"
