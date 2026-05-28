@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan. Install Node.js dulu, lalu jalankan file ini lagi.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8765"
node server.js
pause
