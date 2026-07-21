FlowAccel Self-Contained Installer (v1.0.3)
===========================================

WHAT THIS IS
------------
A single .exe that turns a clean Windows Server / Windows 10+ machine into a
fully running FlowAccel deployment. Bundles every prerequisite (Visual C++
Runtime, IIS modules, Node.js 18 LTS, PostgreSQL 15, NSSM) so no internet
access is needed on the target machine after the .exe is delivered.

FlowAccel 1.0.3 is served over HTTP on port 80. It is IP-independent: IIS binds
every network interface and the app uses relative URLs, so it works at
http://<machine-ip>/ for whatever IP the machine has - even if that IP later
changes (DHCP). Nothing is hardcoded to a specific address.

INSTALLATION
------------
1. Copy FlowAccel-Setup-1.0.3.exe to the target server.
2. Right-click -> Run as administrator.
3. Walk through the wizard. The only thing you must enter is the administrator
   email and password - everything else is pre-filled or optional:
     - Install location          (default: C:\inetpub\flowaccel)
     - Port availability check   (checks 80, 3001, 5432)
     - PostgreSQL passwords      (generated for you - just click Next)
     - Administrator account     (email + password - REQUIRED)
     - JotForm integration       (optional - leave blank to skip)
     - Microsoft sign-in         (optional - leave blank to skip)
4. Click Install. The installer runs its steps; total wall time is typically
   10-15 minutes (PostgreSQL is the longest at 3-5 minutes).
5. When done, the success page shows the URL (http://<machine-ip>/) and the
   service name (FlowAccelBackend).

WHAT THE INSTALLER DOES
-----------------------
  Step 0       Pre-flight checks (admin, OS, disk space)
  Step 2a      Visual C++ Runtime
  Step 2b      Enable IIS Windows features (auto-installs IIS if absent)
  Step 3       URL Rewrite 2.1
  Step 4       Application Request Routing 3.0
  Step 5       Enable ARR reverse-proxy mode
  Step 6       Allow HTTP_X_FORWARDED_PROTO server variable
  Step 7       Node.js 18 LTS
  Step 8       PostgreSQL 15 (unattended)
  Step 9       Create jotflow database + user
  Step 10      Copy application files (+ web.config into the site root)
  Step 11      Generate backend\.env
  Step 12      Install backend npm dependencies
  Step 13      Apply database schema
  Step 14      Set NTFS permissions
  Step 15      Create IIS site + app pool on http://*:80
  Step 16-18   (removed - FlowAccel 1.0.3 is HTTP-only, no certificates)
  Step 19      Install NSSM
  Step 20      Register FlowAccelBackend Windows service (autostart)
  Step 21      Configure Windows Firewall
  Step 22      Start backend service
  Step 23      Start IIS site
  Step 24      End-to-end verification
  Step 25      Finish page with summary

REVERSE PROXY
-------------
IIS serves the React build (the dist\ folder) as the site root and reverse-
proxies /api, /socket.io and /uploads to the Node.js backend on
127.0.0.1:3001 via ARR + URL Rewrite. The proxy port in web.config is filled
in from the configured backend port at install time, so it can never drift.

SILENT INSTALL
--------------
For repeatable / unattended deployment, edit config\config.template.json with
your values and pass:

  FlowAccel-Setup-1.0.3.exe /SILENT /CONFIG=path\to\config.json

RESUME AFTER REBOOT
-------------------
If Windows requests a reboot during IIS feature install (uncommon, ~10% of
clean Server 2016 boxes), the installer drops a "Continue FlowAccel Setup"
shortcut on the All-Users Desktop. After reboot, double-click that shortcut
to resume - every completed step is idempotent and is skipped on re-run.

UNINSTALL
---------
Apps & Features  ->  FlowAccel  ->  Uninstall
or from PowerShell:
  & "C:\inetpub\flowaccel\_payload\scripts\uninstall.ps1" -ConfigPath "C:\inetpub\flowaccel\config.json"

Flags:
  -KeepData               keep uploads/ and logs/ (and database)
  -RemoveSharedComponents prompt for Node/PostgreSQL/IIS module removal

LOG FILES
---------
  Installer log:   <InstallDir>\logs\install-<timestamp>.log
  Service stdout:  <InstallDir>\logs\service-stdout.log
  Service stderr:  <InstallDir>\logs\service-stderr.log
  IIS logs:        %SystemDrive%\inetpub\logs\LogFiles\W3SVC*\

TROUBLESHOOTING
---------------
- "Reboot required" after IIS install:
    Reboot, then re-run the installer (or the desktop shortcut). All completed
    steps are skipped.

- Browser shows "Not secure":
    Expected - FlowAccel 1.0.3 runs over plain HTTP. The app works normally.

- Backend service fails to start:
    Check <InstallDir>\logs\service-stderr.log. Most common cause is a
    DATABASE_URL with characters that need URL-encoding - edit
    <InstallDir>\backend\.env and restart with:
        Restart-Service FlowAccelBackend
