#!/usr/bin/env bash
# Builds a source-only zip of the current working tree into ./output.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="orbitwork-v${VERSION}-${STAMP}"
mkdir -p output
ARCHIVE="output/${NAME}.zip"
rm -f "$ARCHIVE"

zip -qr "$ARCHIVE" . \
  -x 'node_modules/*' 'dist/*' '.data/*' '.npm-cache/*' '.shots/*' 'output/*' \
     '.git/*' '.memsearch/*' '.env' '.env.local' '.env.production' '.env.*.local' '*.log' '.DS_Store' '.chrome-*' '*.tmp'

FILES="$(unzip -Z1 "$ARCHIVE" | wc -l | tr -d ' ')"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-repo')"
echo "[package] ${ARCHIVE}  files=${FILES}  size=$(du -h "$ARCHIVE" | cut -f1)  commit=${COMMIT}"
