@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"

set "LOGFILE=%TEMP%\folio-diag.log"
set "CRASHLOG=%APPDATA%\immersive-reader\ImmersiveReader\crash.log"

echo ================================================
echo  Folio 诊断启动
echo ================================================
echo 目录: %CD%
echo 日志: %LOGFILE%
echo.

if exist "%LOGFILE%" del /q "%LOGFILE%"

echo [1/3] 以兼容模式启动（--no-sandbox --disable-gpu --enable-logging）
start "" /b "%~dp0Folio.exe" --no-sandbox --disable-gpu --enable-logging --log-file="%LOGFILE%"

echo       等待 12 秒 ...
timeout /t 12 /nobreak > nul

echo.
echo [2/3] 进程检查
tasklist /FI "IMAGENAME eq Folio.exe" | find /I "Folio.exe" > nul
if errorlevel 1 (
  echo       ^> 没有 Folio.exe 进程，应用未能启动
) else (
  echo       ^> Folio.exe 正在运行（如果看不到窗口，请截图下面日志）
)

echo.
echo [3/3] 日志内容
echo ------------------------------------------------ [electron log]
if exist "%LOGFILE%" ( type "%LOGFILE%" ) else ( echo  （没有生成 %LOGFILE%） )
echo ------------------------------------------------ [crash.log]
if exist "%CRASHLOG%" ( type "%CRASHLOG%" ) else ( echo  （没有生成 %CRASHLOG%：说明主进程 JS 根本没跑到） )
echo ----------------------------------------------------------------

echo.
echo 请把上面的内容（或 %LOGFILE% 文件）发给开发者。
echo.
pause
