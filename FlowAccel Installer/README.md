# FlowAccel Installer

Self-contained Windows installer for FlowAccel. Single `.exe`, zero
prerequisites on the target machine.

FlowAccel 1.0.3 is **HTTP-only** (port 80) and **IP-independent** — IIS binds
every interface and the app uses relative URLs, so it runs at
`http://<machine-ip>/` for whatever IP the machine has, even after the IP
changes. No certificate, no server IP, nothing address-specific is configured.

## Folder layout

```
FlowAccel Installer/
├── FlowAccel.iss                  Inno Setup 6 script (entry point)
├── build-installer.bat            Dev-machine build script
├── README.md                      This file
├── config/
│   ├── config.template.json       Defaults for silent install
│   └── web.config.template        Canonical HTTP-only IIS config (__BACKEND_PORT__ token)
├── docs/
│   ├── README.txt                 Operator-facing post-install docs
│   └── TRUST-CLIENTS.md           (legacy — not used in HTTP-only 1.0.3)
├── scripts/
│   ├── install.ps1                Step orchestrator
│   ├── uninstall.ps1              Reverse-order teardown
│   └── lib/
│       ├── log.ps1                Timestamped logging
│       ├── prereq.ps1             Step 0: pre-flight checks
│       ├── iis.ps1                Steps 2b, 5, 6: IIS features, ARR, server vars, VC++/MSI helpers
│       ├── node.ps1               Steps 7, 12: Node.js MSI + npm install
│       ├── postgres.ps1           Steps 8, 9, 13: PostgreSQL + DB bootstrap + schema
│       ├── ssl.ps1                (unused in 1.0.3 — HTTP-only; kept for reference)
│       ├── site.ps1               Steps 10, 11, 14, 15, 23: deploy files, .env, NTFS, IIS site
│       ├── service.ps1            Steps 19, 20, 22: NSSM + Windows service
│       ├── firewall.ps1           Step 21: Windows Firewall rules
│       └── verify.ps1             Step 24: end-to-end health checks
├── payload/
│   ├── installers/                Drop third-party binaries here (see installers/README.txt)
│   │   ├── fetch-payloads.ps1     Downloads all six required binaries
│   │   └── README.txt
│   └── app/                       Staged by build-installer.bat (do not edit by hand)
├── trust-bundle/                  Reserved for compile-time-generated artifacts
└── output/                        ISCC writes FlowAccel-Setup-1.0.3.exe here
```

## Building

On a developer machine with internet access:

```cmd
cd "FlowAccel Installer\payload\installers"
powershell -ExecutionPolicy Bypass -File fetch-payloads.ps1

cd ..\..
build-installer.bat
```

Output: `FlowAccel Installer\output\FlowAccel-Setup-1.0.3.exe` (~500 MB).

## Installing on a target server

1. Copy the .exe to the target.
2. Right-click -> Run as administrator.
3. Walk through the wizard (or `/SILENT /CONFIG=path\to\config.json`). The only
   required input is the administrator email + password.
4. Total wall time: 10-15 minutes on a clean Windows Server 2019.
5. Open `http://<machine-ip>/` — works on any IP, no rebuild needed.

## Re-running

The installer is idempotent. Every step skips if its result is already
present. Safe to re-run after a partial failure or to re-deploy a new app
build.

## See also

- `docs/README.txt` - what each install step does, troubleshooting
- `config/config.template.json` - all settings, with defaults
- `config/web.config.template` - the HTTP-only IIS reverse-proxy config

## Replaces

These legacy scripts are kept in the repo for reference only:
`build-for-iis.bat`, `deploy-iis.bat`, `fix-deploy.bat`, `setup-iis.bat`,
`setup-after-reboot.ps1`. New deployments should use `FlowAccel-Setup-1.0.3.exe`.
