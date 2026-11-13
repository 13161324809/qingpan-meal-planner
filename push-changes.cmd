@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--help" goto help

git --version >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or is missing from PATH.
  goto failed
)
if not exist ".git" (
  echo This folder is not a Git checkout.
  goto failed
)
for /f "delims=" %%B in ('git branch --show-current') do set "pushBranch=%%B"
if not "%pushBranch%"=="main" (
  echo Please switch to main before running this script.
  goto failed
)
git var GIT_AUTHOR_IDENT >nul 2>&1
if errorlevel 1 (
  echo Please configure your Git name and email first:
  echo git config user.name "Your Name"
  echo git config user.email "Your GitHub email"
  goto failed
)
git diff --cached --quiet
if errorlevel 1 (
  echo Existing staged changes were found. Review them before using this script.
  echo Run git status to inspect; this script has not changed them.
  goto failed
)

call "%~dp0pull-latest.cmd" --no-pause
if errorlevel 1 goto failed
node --test tests/core.test.cjs tests/catalog.test.cjs tests/solver-client.test.cjs tests/ui.test.cjs
if errorlevel 1 goto failed

rem Stage public project files only; exclude personal records and screenshots.
git add -A -- .github .gitignore .nojekyll AGENTS.md CHANGELOG.md LICENSE README.md app.js build.cjs core.js index.html package.json server.cjs solver-client.js solver-worker-source.js styles.css worker.js data/foods.json data/foods.js "docs/*.md" tests vendor pull-latest.cmd push-changes.cmd
if errorlevel 1 goto failed
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Update meal planner"
  if errorlevel 1 goto failed
) else (
  echo No new changes to commit. Checking for existing commits to push.
)

git push origin main
if errorlevel 1 (
  echo Push failed. Any local commit is kept; rerun after fixing login or network.
  echo If prompted, complete GitHub sign-in in your browser.
  goto failed
)
echo.
echo Upload complete. GitHub Pages will update after its workflow succeeds.
goto finished

:help
echo Usage: push-changes.cmd [--no-pause]
echo Pull latest code, build, test, commit public project files, then push main.
echo Personal data, backups, archives and local screenshots are not added.
exit /b 0

:failed
echo.
echo Submission stopped. Keep this output for troubleshooting.
set "pushExitCode=1"

:finished
if not defined pushExitCode set "pushExitCode=0"
if /i not "%~1"=="--no-pause" pause
exit /b %pushExitCode%
