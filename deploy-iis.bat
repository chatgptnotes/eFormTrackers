@echo off
REM ═══════════════════════════════════════════════════════════════
REM  JotFlow — Deploy to IIS (Run as Administrator)
REM  Deploys frontend build + backend + server.js to inetpub
REM ═══════════════════════════════════════════════════════════════

set DEPLOY_DIR=C:\inetpub\jotflow
set PROJECT_DIR=%~dp0

echo.
echo ══════════════════════════════════════════════
echo   JotFlow IIS Deployment
echo ══════════════════════════════════════════════
echo.
echo  Source:  %PROJECT_DIR%
echo  Target:  %DEPLOY_DIR%
echo.

REM ── Step 1: Build frontend ──
echo [1/7] Building frontend...
cd /d "%PROJECT_DIR%frontend"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

REM ── Step 2: Build backend ──
echo [2/7] Building backend...
cd /d "%PROJECT_DIR%backend"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)

REM ── Step 3: Create deployment directory ──
echo [3/7] Creating deployment directory...
if not exist "%DEPLOY_DIR%" mkdir "%DEPLOY_DIR%"

REM ── Step 4: Copy files ──
echo [4/7] Copying files to %DEPLOY_DIR%...

REM Copy root entry point and web.config
copy /Y "%PROJECT_DIR%server.js" "%DEPLOY_DIR%\server.js" >nul
copy /Y "%PROJECT_DIR%web.config" "%DEPLOY_DIR%\web.config" >nul

REM Copy React build output (dist/)
echo   - Copying dist\ ...
if exist "%DEPLOY_DIR%\dist" rmdir /S /Q "%DEPLOY_DIR%\dist"
xcopy "%PROJECT_DIR%dist" "%DEPLOY_DIR%\dist\" /E /I /Q >nul

REM Copy backend (excluding node_modules and .env)
echo   - Copying backend\ ...
if exist "%DEPLOY_DIR%\backend" (
    REM Preserve .env and uploads
    if exist "%DEPLOY_DIR%\backend\.env" copy "%DEPLOY_DIR%\backend\.env" "%TEMP%\jotflow-env-backup" >nul
    rmdir /S /Q "%DEPLOY_DIR%\backend" >nul 2>nul
)
xcopy "%PROJECT_DIR%backend" "%DEPLOY_DIR%\backend\" /E /I /Q /EXCLUDE:%PROJECT_DIR%deploy-exclude.txt >nul 2>nul
if not exist "%DEPLOY_DIR%\backend" (
    xcopy "%PROJECT_DIR%backend" "%DEPLOY_DIR%\backend\" /E /I /Q >nul
)
REM Restore .env if backed up
if exist "%TEMP%\jotflow-env-backup" (
    copy "%TEMP%\jotflow-env-backup" "%DEPLOY_DIR%\backend\.env" >nul
    del "%TEMP%\jotflow-env-backup" >nul
)

REM ── Step 5: Install backend dependencies ──
echo [5/7] Installing backend dependencies (production)...
cd /d "%DEPLOY_DIR%\backend"
call npm install --production
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: npm install had issues. Check manually.
)

REM ── Step 6: Set up .env ──
echo [6/7] Checking .env...
if not exist "%DEPLOY_DIR%\backend\.env" (
    if exist "%DEPLOY_DIR%\backend\.env.production" (
        copy "%DEPLOY_DIR%\backend\.env.production" "%DEPLOY_DIR%\backend\.env" >nul
        echo   Copied .env.production to .env — EDIT with real values!
    ) else if exist "%PROJECT_DIR%backend\.env.production" (
        copy "%PROJECT_DIR%backend\.env.production" "%DEPLOY_DIR%\backend\.env" >nul
        echo   Copied .env.production to .env — EDIT with real values!
    ) else (
        echo   WARNING: No .env file found! Create backend\.env before starting.
    )
) else (
    echo   .env already exists — keeping existing.
)

REM ── Step 7: Create directories and set permissions ──
echo [7/7] Setting up directories and permissions...
if not exist "%DEPLOY_DIR%\backend\uploads\avatars" mkdir "%DEPLOY_DIR%\backend\uploads\avatars"
if not exist "%DEPLOY_DIR%\backend\uploads\signatures" mkdir "%DEPLOY_DIR%\backend\uploads\signatures"
if not exist "%DEPLOY_DIR%\backend\logs" mkdir "%DEPLOY_DIR%\backend\logs"

icacls "%DEPLOY_DIR%" /grant "IIS_IUSRS:(OI)(CI)M" /T /Q >nul 2>nul
icacls "%DEPLOY_DIR%" /grant "IUSR:(OI)(CI)M" /T /Q >nul 2>nul

echo.
echo ══════════════════════════════════════════════
echo  DEPLOYMENT COMPLETE!
echo ══════════════════════════════════════════════
echo.
echo  Deployed structure:
echo    %DEPLOY_DIR%\
echo    ├── dist\         (React build)
echo    ├── backend\      (Express API + node_modules)
echo    ├── server.js     (Unified entry point)
echo    └── web.config    (IIS rewrite rules)
echo.
echo  Next steps:
echo    1. Edit %DEPLOY_DIR%\backend\.env (if first time)
echo    2. Run migration: cd %DEPLOY_DIR%\backend ^& node db/migrate.js
echo    3. Start backend: pm2 start %DEPLOY_DIR%\backend\ecosystem.config.js
echo    4. In IIS Manager: point site to %DEPLOY_DIR%\dist
echo    5. Browse: http://localhost
echo.
pause
