Third-party installer payloads
==============================

This folder must contain these six files before running build-installer.bat.
They are NOT committed to source control (large binaries, vendor-distributed).

REQUIRED FILES
--------------

  VC_redist.x64.exe                    (~25 MB)
    Microsoft Visual C++ 2015-2022 Redistributable (x64).
    Download: https://aka.ms/vs/17/release/vc_redist.x64.exe

  node-v18.20.4-x64.msi                (~30 MB)
    Node.js 18 LTS for Windows x64.
    Download: https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi

  postgresql-15.8-1-windows-x64.exe    (~370 MB)
    EnterpriseDB PostgreSQL 15.8 Windows installer.
    Download: https://get.enterprisedb.com/postgresql/postgresql-15.8-1-windows-x64.exe

  rewrite_amd64_en-US.msi              (~7 MB)
    IIS URL Rewrite Module 2.1 (64-bit).
    Download: https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi

  requestRouter_amd64.msi              (~7 MB)
    IIS Application Request Routing 3.0 (64-bit).
    Download: https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi

  nssm-2.24.zip                        (~350 KB)
    Non-Sucking Service Manager 2.24.
    Download: https://nssm.cc/release/nssm-2.24.zip

AUTOMATED FETCH
---------------
On a dev machine with internet access, run fetch-payloads.ps1 (sibling of this README)
to download all six in one go. The build script generates SHA256SUMS.txt, and
the resulting installer checks those hashes before it runs any payload.
