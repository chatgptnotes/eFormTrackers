FlowAccel Server Installer (Windows) - Multi-Part Download
===========================================================

1. Download every FlowAccel-Setup-1.0.4.7z.NNN listed in SHA256SUMS.txt
   from this folder, plus SHA256SUMS.txt itself. Place all files in
   one folder (your browser may auto-download all of them after a
   single "Allow multiple downloads" prompt).

2. Install 7-Zip if you don't already have it:

      winget install 7zip.7zip

3. Extract:

      Right-click FlowAccel-Setup-1.0.4.7z.001 -> 7-Zip -> Extract Here

   Or from the command line:

      "C:\Program Files\7-Zip\7z.exe" x FlowAccel-Setup-1.0.4.7z.001

   7-Zip auto-detects parts .002 through .005 and produces
   FlowAccel-Setup-1.0.4.exe in the same folder.

4. Verify (optional):

      certutil -hashfile FlowAccel-Setup-1.0.4.exe SHA256

   Compare the result to the "extracted" line in SHA256SUMS.txt.

5. Right-click FlowAccel-Setup-1.0.4.exe and Run as administrator. The
   setup wizard installs Node 18, PostgreSQL 15, IIS URL Rewrite,
   IIS Application Request Routing, NSSM, and FlowAccel itself.

   The install runs in a VISIBLE console window so you can watch each
   dependency install live. If a required dependency fails, the installer
   aborts, shows the error, and rolls back its own changes. When it
   finishes it prints the site URL (http://localhost/), the install
   directory, and a logs URL (http://localhost/logs/) where every install
   and service log can be browsed.

No Inno Setup or Node is required on your machine - the installer
is self-contained. Only 7-Zip is needed to unpack the download.
