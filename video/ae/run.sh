#!/bin/bash
# Builds the After Effects project: timeline + build.jsx -> build/PlayGuard.aep
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT=build/run.jsx
{
  echo "var ROOT = \"$ROOT\";"
  echo "var TL = $(cat build/timeline.json);"
  echo "var TALK = $(cat build/talk.json);"
  echo "try {"
  cat ae/build.jsx
  echo "} catch (e) { var f = new File(ROOT + '/build/ae_log.txt'); f.open('w'); f.write('ERROR line ' + e.line + ': ' + e.toString()); f.close(); }"
} > "$OUT"
rm -f build/ae_log.txt
osascript -e "tell application \"Adobe After Effects 2026\" to DoScriptFile \"$ROOT/$OUT\""
cat build/ae_log.txt
