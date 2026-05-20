#!/usr/bin/env bash
# reassemble.sh - rebuild FlowAccel-Setup-1.0.4.exe from the .part chunks.
# Run from the release-chunks folder:  ./reassemble.sh
set -euo pipefail
cd "$(dirname "$0")"

ZIP="FlowAccel-Setup-1.0.4.zip"
EXE="FlowAccel-Setup-1.0.4.exe"
EXE_HASH="0cac23693a42e1dc269c2bf4fc72d899db572ab37c93a97735393c28e780bb40"

echo "Joining chunks into $ZIP ..."
cat FlowAccel-Setup-1.0.4.zip.*.part > "$ZIP"

echo "Extracting $EXE ..."
unzip -o "$ZIP" >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  GOT=$(sha256sum "$EXE" | awk '{print $1}')
else
  GOT=$(shasum -a 256 "$EXE" | awk '{print $1}')
fi

if [ "$GOT" = "$EXE_HASH" ]; then
  echo "OK - $EXE rebuilt and checksum verified."
  rm -f "$ZIP"
else
  echo "CHECKSUM MISMATCH - do not run the .exe."
  echo "  expected: $EXE_HASH"
  echo "  got:      $GOT"
  exit 1
fi
