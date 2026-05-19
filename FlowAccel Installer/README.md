# FlowAccel Installer

Self-contained Windows installer for FlowAccel. Single `.exe`, zero
prerequisites on the target machine.

## Folder layout

```
FlowAccel Installer/
├── FlowAccel.iss                  Inno Setup 6 script (entry point)
├── build-installer.bat            Dev-machine build script
├── README.md                      This file
├── config/
│   └── config.template.json       Defaults for silent install
├── docs/
│   ├── README.txt                 Operator-facing post-install docs
│   └── TRUST-CLIENTS.md           LAN client trust distribution guide
├── scripts/
│   ├── install.ps1                25-step orchestrator
│   ├── uninstall.ps1              Reverse-order teardown
│   └── lib/
│       ├── log.ps1                Timestamped logging
│       ├── prereq.ps1             Step 0: pre-flight checks
│       ├── iis.ps1                Steps 2b, 5, 6: IIS features, ARR, server vars, VC++/MSI helpers
│       ├── node.ps1               Steps 7, 12: Node.js MSI + npm install
│       ├── postgres.ps1           Steps 8, 9, 13: PostgreSQL + DB bootstrap + schema
│       ├── ssl.ps1                Steps 16-18: Root CA, leaf cert, trust bundle, HTTPS binding
│       ├── site.ps1               Steps 10, 11, 14, 15, 23: deploy files, .env, NTFS, IIS site
│       ├── service.ps1            Steps 19, 20, 22: NSSM + Windows service
│       ├── firewall.ps1           Step 21: 9-rule firewall set
│       └── verify.ps1             Step 24: end-to-end health checks
├── payload/
│   ├── installers/                Drop third-party binaries here (see installers/README.txt)
│   │   ├── fetch-payloads.ps1     Downloads all six required binaries
│   │   └── README.txt
│   └── app/                       Staged by build-installer.bat (do not edit by hand)
├── trust-bundle/                  Reserved for compile-time-generated artifacts
└── output/                        ISCC writes FlowAccel-Setup-1.0.2.exe here
```

## Building

On a developer machine with internet access:

```cmd
cd "FlowAccel Installer\payload\installers"
powershell -ExecutionPolicy Bypass -File fetch-payloads.ps1

cd ..\..
build-installer.bat
```

Output: `FlowAccel Installer\output\FlowAccel-Setup-1.0.2.exe` (~525 MB).

## Installing on a target server

1. Copy the .exe to the target.
2. Right-click -> Run as administrator.
3. Walk through the wizard (or `/SILENT /CONFIG=path\to\config.json`).
4. Total wall time: 10-15 minutes on a clean Windows Server 2019.

## Re-running

The installer is idempotent. Every step skips if its result is already
present. Safe to re-run after a partial failure or to re-deploy a new app
build.

## See also

- `docs/README.txt` - what each install step does, troubleshooting
- `docs/TRUST-CLIENTS.md` - how to distribute the Root CA to LAN clients
- `config/config.template.json` - all settings, with defaults

## Replaces

These legacy scripts are kept in the repo for reference only:
`build-for-iis.bat`, `deploy-iis.bat`, `fix-deploy.bat`, `setup-iis.bat`,
`setup-after-reboot.ps1`. New deployments should use `FlowAccel-Setup-1.0.2.exe`.
