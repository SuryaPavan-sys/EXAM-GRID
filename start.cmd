@echo off
rem Starts the ExamGrid website at http://localhost:3000
rem Uses the portable Node.js in .tools if present, otherwise the one on PATH.
setlocal
set ROOT=%~dp0
if exist "%ROOT%.tools\node-v20.18.0-win-x64\node.exe" set PATH=%ROOT%.tools\node-v20.18.0-win-x64;%PATH%

if not exist "%ROOT%web\server\node_modules" (
  echo Installing server packages...
  pushd "%ROOT%web\server" && call npm install --no-fund --no-audit && popd
)
if not exist "%ROOT%web\client\dist\index.html" (
  echo Building the website...
  pushd "%ROOT%web\client" && call npm install --no-fund --no-audit && call npm run build && popd
)
if not exist "%ROOT%output\full\seating.csv" (
  echo No plan found in output\full. Run the pipeline first - see README "Run everything".
)
cd /d "%ROOT%web\server"
node src\index.js
