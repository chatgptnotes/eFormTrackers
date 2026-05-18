@echo off
REM FlowAccel backend launcher - keeps Node running, auto-restarts on crash.
cd /d "C:\Website\flowaccel\backend"
if not exist logs mkdir logs

:loop
echo [%date% %time%] starting backend >> logs\backend.log
"C:\Program Files\nodejs\node.exe" server.js >> logs\backend.log 2>&1
echo [%date% %time%] backend exited (code %errorlevel%) - restarting in 5s >> logs\backend.log
ping -n 6 127.0.0.1 >nul
goto loop
