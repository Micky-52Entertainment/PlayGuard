@echo off
rem Double-click to start PlayGuard on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo PlayGuard needs Node.js. Install it from https://nodejs.org and start again.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
