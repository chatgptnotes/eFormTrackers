@echo off
REM ═══════════════════════════════════════════════════════════════
REM  JotFlow — Build Everything into a ready-to-deploy folder
REM  After running this, just copy "deploy-output\" to C:\inetpub\jotflow\
REM ═══════════════════════════════════════════════════════════════

set PROJECT_DIR=%~dp0
set OUTPUT_DIR=%PROJECT_DIR%deploy-output

echo.
echo ══════════════════════════════════════════════
echo   JotFlow — Build for IIS Deployment
echo ══════════════════════════════════════════════
echo.

REM ─��� Clean previous output ──
if exist "%OUTPUT_DIR%" rmdir /S /Q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"

REM ── Step 1: Build frontend ──
echo [1/4] Building frontend...
cd /d "%PROJECT_DIR%frontend"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

REM ── Step 2: Install backend production deps ──
echo [2/4] Installing backend production dependencies...
cd /d "%PROJECT_DIR%backend"
call npm install --production
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Backend npm install failed!
    pause
    exit /b 1
)

REM ── Step 3: Copy everything to deploy-output ──
echo [3/4] Assembling deploy-output folder...

REM Frontend build
xcopy "%PROJECT_DIR%dist" "%OUTPUT_DIR%\dist\" /E /I /Q >nul

REM Backend (source + node_modules, exclude .env)
xcopy "%PROJECT_DIR%backend\config" "%OUTPUT_DIR%\backend\config\" /E /I /Q >nul
xcopy "%PROJECT_DIR%backend\db" "%OUTPUT_DIR%\backend\db\" /E /I /Q >nul
xcopy "%PROJECT_DIR%backend\lib" "%OUTPUT_DIR%\backend\lib\" /E /I /Q >nul
xcopy "%PROJECT_DIR%backend\middleware" "%OUTPUT_DIR%\backend\middleware\" /E /I /Q >nul
xcopy "%PROJECT_DIR%backend\routes" "%OUTPUT_DIR%\backend\routes\" /E /I /Q >nul
xcopy "%PROJECT_DIR%backend\node_modules" "%OUTPUT_DIR%\backend\node_modules\" /E /I /Q >nul
copy /Y "%PROJECT_DIR%backend\server.js" "%OUTPUT_DIR%\backend\server.js" >nul
copy /Y "%PROJECT_DIR%backend\package.json" "%OUTPUT_DIR%\backend\package.json" >nul
copy /Y "%PROJECT_DIR%backend\ecosystem.config.js" "%OUTPUT_DIR%\backend\ecosystem.config.js" >nul
if exist "%PROJECT_DIR%backend\.env.production" copy /Y "%PROJECT_DIR%backend\.env.production" "%OUTPUT_DIR%\backend\.env.production" >nul

REM Create upload and log directories
mkdir "%OUTPUT_DIR%\backend\uploads\avatars" 2>nul
mkdir "%OUTPUT_DIR%\backend\uploads\signatures" 2>nul
mkdir "%OUTPUT_DIR%\backend\logs" 2>nul

REM Root files
copy /Y "%PROJECT_DIR%server.js" "%OUTPUT_DIR%\server.js" >nul
copy /Y "%PROJECT_DIR%web.config" "%OUTPUT_DIR%\web.config" >nul

REM ── Step 4: Done ──
echo [4/4] Done!
echo.
echo ══════════════════════════════════════════════
echo  BUILD COMPLETE!
echo ══════════════════════════════════════════════
echo.
echo  Output folder: %OUTPUT_DIR%
echo.
echo  Structure:
echo    deploy-output\
echo    ├── dist\            (React app - static files)
echo    ├── backend\         (Express API + node_modules)
echo    │   ├── server.js
echo    │   ├── routes\
echo    │   ���── node_modules\
echo    │   └── ...
echo    ├── server.js        (Unified entry point)
echo    └── web.config       (IIS rewrite rules)
echo.
echo  TO DEPLOY:
echo    1. Copy contents of deploy-output\ to C:\inetpub\jotflow\
echo    2. Create C:\inetpub\jotflow\backend\.env (from .env.production)
echo    3. Run: cd C:\inetpub\jotflow\backend ^& node db/migrate.js
echo    4. Run: pm2 start C:\inetpub\jotflow\backend\ecosystem.config.js
echo    5. Point IIS site to C:\inetpub\jotflow\dist
echo.
pause
