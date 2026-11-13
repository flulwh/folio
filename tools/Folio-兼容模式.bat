@echo off
rem Folio 兼容模式启动器
rem
rem 部分机器上（受限账户、安全软件、受限沙箱）Electron 默认的 Chromium 沙箱
rem 初始化会失败，表现为「双击 Folio.exe 完全没反应」或进程一闪而过。
rem 这个脚本用 --no-sandbox 与 --disable-gpu 启动，绕开这两类问题。
rem
rem 若窗口仍然不出现，请把
rem   %APPDATA%\immersive-reader\ImmersiveReader\crash.log
rem 的内容发出来（该文件由程序自动写入）。

cd /d "%~dp0"
echo 正在以兼容模式启动 Folio ...
start "" "%~dp0Folio.exe" --no-sandbox --disable-gpu %*
