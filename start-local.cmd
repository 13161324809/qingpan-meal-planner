@echo off
setlocal
cd /d "%~dp0"
set "mealNode=node"
where node >nul 2>&1
if errorlevel 1 set "mealNode=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%mealNode%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js and try again.
  pause
  exit /b 1
)
echo Keep this window open while using the app.
echo Data is saved automatically to personal-data in this folder.
"%mealNode%" server.cjs --open
pause
