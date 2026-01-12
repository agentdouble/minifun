@echo off
setlocal

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

if not exist node_modules\ (
  npm install
  if errorlevel 1 exit /b 1
)

npm start
