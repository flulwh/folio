@echo off
rem Folio 公告发布器：双击运行。优先用 pythonw（不弹黑框），没有就退回 python。
setlocal
cd /d "%~dp0.."
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "%~dp0_announce.py"
) else (
  python "%~dp0_announce.py"
  if errorlevel 1 pause
)
