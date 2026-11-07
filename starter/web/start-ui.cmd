@echo off
setlocal
cd /d "%~dp0"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  echo Codex Node.js not found. Install Node.js LTS, then run npm install and npm run dev.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Project dependencies not found. Install Node.js LTS, then run npm install.
  pause
  exit /b 1
)
echo Starting the UI prototype. Open the Local URL shown below.
echo Press Ctrl+C to stop.
"%NODE_EXE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1
pause
