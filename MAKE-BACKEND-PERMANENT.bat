@echo off
title FlowAccel - Make Backend Permanent
REM Self-elevate to Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights... click YES on the popup.
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo  [1/5] Stopping old backend processes...
wmic process where "name='cmd.exe' and commandline like '%%run-backend%%'" call terminate >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo  [2/5] Removing any old task...
schtasks /delete /tn "FlowAccel Backend" /f >nul 2>&1

echo  [3/5] Creating PERMANENT SYSTEM task (auto-start at every boot)...
schtasks /create /tn "FlowAccel Backend" /tr "cmd /c \"C:\Website\flowaccel\backend\run-backend.cmd\"" /sc onstart /ru SYSTEM /rl HIGHEST /f

echo  [4/5] Starting the backend now...
schtasks /run /tn "FlowAccel Backend"

echo  [5/5] Waiting for backend to come up...
ping -n 16 127.0.0.1 >nul

echo.
echo  ---------------- STATUS ----------------
schtasks /query /tn "FlowAccel Backend" /fo LIST | findstr /i "TaskName Status"
netstat -ano | findstr ":3001" | findstr LISTENING >nul && (echo  Backend port 3001 : LISTENING - OK) || (echo  Backend port 3001 : starting - wait a few seconds)
echo  ----------------------------------------
echo.
echo  ========================================================
echo   DONE.  Backend is now PERMANENT.
echo   It auto-starts on EVERY PC restart - as SYSTEM.
echo   You do NOT need to run this again.
echo  ========================================================
echo.
pause
