@echo off
setlocal
chcp 65001 > nul
title Folio Dev
cd /d "%~dp0..\"
set "LOG=%~dp0dev-run.log"

echo [%date% %time%] Folio dev starting > "%LOG%"
where npm >> "%LOG%" 2>&1
where node >> "%LOG%" 2>&1

call npm run dev >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] npm failed, fallback to D:\node\npm.cmd >> "%LOG%"
  if exist "D:\node\npm.cmd" call "D:\node\npm.cmd" run dev >> "%LOG%" 2>&1
)
echo [%date% %time%] dev exited >> "%LOG%"
