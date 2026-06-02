#!/usr/bin/env bash
# Render docs/pgadmin-sql-optimization-guide.html to a printable A4 PDF.
# Uses headless Chrome — no Python or native libs required.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML="$HERE/pgadmin-sql-optimization-guide.html"
PDF="$HERE/JotFlow-PostgreSQL-Optimization-pgAdmin.pdf"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v chromium || command -v chrome || true)"
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "Could not find Google Chrome or Chromium. Install Chrome or set CHROME in this script." >&2
  exit 1
fi

if [ ! -f "$HTML" ]; then
  echo "Missing source file: $HTML" >&2
  exit 1
fi

"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-pdf-header-footer \
  --print-to-pdf-no-header \
  --print-to-pdf="$PDF" \
  --virtual-time-budget=10000 \
  "file://$HTML" >/dev/null 2>&1

echo "Wrote: $PDF"
