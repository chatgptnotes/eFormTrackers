FlowAccel Self-Contained Installer
===================================

WHAT THIS IS
------------
A single .exe that turns a clean Windows Server / Windows 10+ machine into a
fully running FlowAccel deployment. Bundles every prerequisite (Visual C++
Runtime, IIS modules, Node.js 18 LTS, PostgreSQL 15, NSSM) so no internet
access is needed on the target machine after the .exe is delivered.

INSTALLATION
------------
1. Copy FlowAccel-Setup-1.0.exe to the target server.
2. Right-click -> Run as administrator.
3. Walk through the 6 wizard pages:
     - Install location               (default: C:\inetpub\flowaccel)
     - Network                        (server IP, HTTP/HTTPS ports)
     - PostgreSQL passwords
     - JotForm integration            (optional)
     - Microsoft sign-in              (optional)
     - HTTPS certificate strategy     (SelfSignedCA recommended)
4. Click Install. The installer runs 25 steps; total wall time is typically
   10-15 minutes (PostgreSQL is the longest at 3-5 minutes).
5. When done, the success page shows the URL (https://<server-ip>/), the
   service name (FlowAccelBackend), and the Root CA thumbprint to share
   with LAN clients.

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
  Step 10      Copy application files
  Step 11      Generate backend\.env
  Step 12      Install backend npm dependencies
  Step 13      Apply database schema
  Step 14      Set NTFS permissions
  Step 15      Create IIS site + app pool
  Step 16-17   TLS: generate Root CA + leaf cert, build client trust bundle
  Step 18      Bind HTTPS:443 to leaf cert
  Step 19      Install NSSM
  Step 20      Register FlowAccelBackend Windows service (autostart)
  Step 21      Configure Windows Firewall (9 rules)
  Step 22      Start backend service
  Step 23      Start IIS site
  Step 24      End-to-end verification
  Step 25      Finish page with summary

SILENT INSTALL
--------------
For repeatable / unattended deployment, edit config\config.template.json with
your values and pass:

  FlowAccel-Setup-1.0.exe /SILENT /CONFIG=path\to\config.json

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
  -KeepData              keep uploads/ and logs/ (and database)
  -PurgeCA               also remove the Root CA from server's trust store
  -RemoveSharedComponents prompt for Node/PostgreSQL/IIS module removal

CLIENT TRUST DISTRIBUTION
-------------------------
See TRUST-CLIENTS.md (also published at  http://<server-ip>/trust-flowaccel/README.txt
on the running server) for how to trust the Root CA on each LAN client. Once
trusted, all future server cert renewals are automatic - no further client
action required.

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

- HTTPS shows NET::ERR_CERT_AUTHORITY_INVALID on a LAN client:
    The client has not yet trusted the FlowAccel Root CA. Browse to
    http://<server-ip>/trust-flowaccel/  and run install-trust.bat as admin.

- Backend service fails to start:
    Check <InstallDir>\logs\service-stderr.log. Most common cause is a
    DATABASE_URL with characters that need URL-encoding - edit
    <InstallDir>\backend\.env and restart with:
        Restart-Service FlowAccelBackend
