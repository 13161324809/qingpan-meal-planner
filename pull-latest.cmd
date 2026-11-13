@echo off
setlocal
cd /d "%~dp0"

git --version >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or is missing from PATH.
  goto failed
)

if not exist ".git" (
  echo This folder is not a Git checkout. Please ask for setup first.
  goto failed
)

git diff --quiet --diff-filter=U
if errorlevel 1 (
  echo Unresolved conflicts exist. Resolve them before pulling again.
  goto failed
)

git pull --ff-only --autostash origin main
if errorlevel 1 goto failed

git diff --quiet --diff-filter=U
if errorlevel 1 (
  echo Local changes conflicted with the update. The stash is preserved.
  echo Run git status and git stash list to inspect. Do not discard changes.
  goto failed
)

node build.cjs
if errorlevel 1 goto failed

echo.
echo Update complete. Local changes were preserved. Nothing was uploaded.
git log -1 --oneline
goto finished

:failed
echo.
echo Update stopped. Keep this output for troubleshooting.
set "pullExitCode=1"

:finished
if not defined pullExitCode set "pullExitCode=0"
if /i not "%~1"=="--no-pause" pause
exit /b %pullExitCode%
