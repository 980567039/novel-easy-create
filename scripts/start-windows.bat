@echo off
setlocal
cd /d "%~dp0.."

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo 未找到 PowerShell，无法启动项目。
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo 项目启动失败，错误代码：%EXIT_CODE%
)

pause
exit /b %EXIT_CODE%
