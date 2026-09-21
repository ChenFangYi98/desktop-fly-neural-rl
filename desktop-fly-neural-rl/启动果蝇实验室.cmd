@echo off
setlocal
cd /d "%~dp0windows"
set "DESKTOPFLY_LAB_ONLY=1"
set "DESKTOPFLY_APP_MODE=observation"

rem First launch only: install the local Electron runtime when it is missing.
if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在首次安装果蝇实验室运行组件，请稍候...
  call npm install
  if errorlevel 1 (
    echo.
    echo 安装失败。请确认已经安装 Node.js 并且网络可用。
    pause
    exit /b 1
  )
)

rem Laboratory mode hides the transparent desktop fly while retaining the
rem complete background neural simulation used by observation and training.
call npm start
