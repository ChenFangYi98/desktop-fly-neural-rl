@echo off
setlocal
cd /d "%~dp0windows"
set "DESKTOPFLY_LAB_ONLY=1"
set "DESKTOPFLY_APP_MODE=training"

if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在首次安装训练中心运行组件，请稍候...
  call npm install
  if errorlevel 1 (
    echo 安装失败，请确认已安装 Node.js 并且网络可用。
    pause
    exit /b 1
  )
)

call npm start
