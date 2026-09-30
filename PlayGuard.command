#!/bin/bash
# Double-click to start PlayGuard on macOS.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "PlayGuard needs Node.js. Install it from https://nodejs.org and start again."
  echo "Для PlayGuard нужен Node.js. Установите его с https://nodejs.org и запустите снова."
  read -r -p "Enter: " _
  exit 1
fi
node scripts/start.mjs
status=$?
if [ "$status" -ne 0 ]; then
  read -r -p "Enter: " _
fi
exit "$status"
